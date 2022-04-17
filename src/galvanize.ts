
/**
 * A key in a state map.
 */
export type StateKey = string | number | symbol;
/**
 * A value in a state map.
 */
export type StateValue = any;

/**
 * An object containing a graph's state.
 */
interface StateMap {
    [name: StateKey]: StateValue;
};

/**
 * A function which will have its dependencies automatically detected.
 * Derivers are used to derive a state's value from other states in a StateGraph.
 */
type AutoDerived = (state: any /* StateMap */, graph: StateGraph) => StateValue;
/**
 * An async function which will have its dependencies automatically derived.
 */
type AutoDerivedRequest = (state: any /* StateMap */, graph: StateGraph) => Promise<StateValue>;

/**
 * An object representing a deriver function. AutoDerived will be automatically converted into this.
 */
interface ExplicitlyDerived<TFunc = AutoDerived> {
    params: StateKey[];
    func: TFunc;
    order?: string;
    is_request?: boolean;
};

/**
 * The various arguments for a StateGraph.
 */
export interface StateGraphArgs {
    /**
     * All derivers for this StateGraph.
     */
    derivers?: {
        [name: StateKey]: AutoDerived | ExplicitlyDerived;
    };
    /**
     * Properties to inherit. Any object that conforms to the property interface can be used here.
     * Values will act the exact same as a derived or base state.
     */
    properties?: {
        [name: StateKey]: Property;
    };
    /**
     * Effectively the same as a deriver, except the function must return a promise, or null.
     * The StateGraph will automatically connect to returned promises, and populate the matching state with their resolved value.
     */
    requests?: {
        [name: StateKey]: AutoDerivedRequest | ExplicitlyDerived<AutoDerivedRequest>;
    };
    /**
     * Any default values to set in the state initially.
     * A property does not need to be set for a deriver to depend on it; dependencies are separate from the state entirely.
     */
    defaults?: StateMap;
};

const PropGetReporter = (fetched: StateKey[]) => {
    return new Proxy({}, {
        get: (_, name) => {
            fetched.push(name);
            return undefined;
        }
    });
};

const ExtractDeriver = (fn: any): ExplicitlyDerived => {
    const proplist = [];
    const getter = PropGetReporter(proplist);

    try {
        fn(getter);
    } catch (error) {
        console.error(error);
        throw new Error("could not automatically extract dependencies from function");
    }

    return {
        params: proplist,
        func: fn
    };
};

/**
 * Throttles a request deriver, preventing further requests from being sent prior to the previous has finishing.
 */
export const ThrottleRequest = (request: ((state: any /* StateMap */, graph: StateGraph) => Promise<StateValue>)) => {

    let in_progress = false;

    return (state: any, graph: StateGraph) => {
        if(in_progress) {
            return null;
        }

        const p = request(state, graph);

        if(p) {
            in_progress = true;
            return p.finally(() => in_progress = false);
        } else {
            return null;
        }
    };
};

/**
 * Represents a state value that can be gotten, set, and watched.
 * Implementing `wrapped` and `navigate` is optional, but recommended.
 */
export interface Property {
    get value(): any;

    set value(newValue: any);

    propname: StateKey;

    watch(watcher: (prop:any)=>void): ()=>void;

    wrapped(getter?: (value:any)=>any, setter?: (value:any)=>any): Property;

    navigate(key: StateKey): Property;
}

export type PropertyWatcher = (prop: Property)=>void;

class StateGraphProperty implements Property {
    constructor(public state: StateGraph, public propname: StateKey, protected onset?: PropertyWatcher) { }

    get value(): any {
        return this.state.state[this.propname];
    }

    set value(newValue: any) {
        this.state.push({[this.propname]: newValue});
        this.onset && this.onset(this);
    }

    watch(watcher: PropertyWatcher) {
        return this.state.watch(this.propname, () => watcher(this));
    }

    wrapped(getter?: (value:any)=>any, setter?: (value:any)=>any): Property {
        return new WrappedProperty(this, getter, setter, () => this.onset && this.onset(this));
    }

    navigate(key: StateKey): Property {
        return new NavigatedProperty(this, key, this.onset);
    }
}

/**
 * A property that exists on an external object.
 * The state's lifetime is bound to the object passed to the constructor, not the property object.
 * Can be used to wrap another library's state into galvanize.
 * 
 * CANNOT detect state changes made outside of `set value()`.
 * If the watcher list should be persisted between ObjectProperty instances, a shared array should be passed into the constructor.
 * The watcher list NEEDS to be set if this object is passed to a StateGraph, as the property inheritance system depends on watching properties.
 */
export class ObjectProperty implements Property {
    /**
     * Creates a new ObjectProperty.
     * @param state The state object to bind to.
     * @param propname The key in the state object.
     * @param watchers If this object is transient, the watcher list should be persisted between instances. Treat this as an opaque handle.
     * @param onset Called when this property is set.
     */
    constructor(public state: Object, public propname: StateKey, protected watchers: PropertyWatcher[] = [], protected onset?: PropertyWatcher) { }

    get value(): any {
        return this.state[this.propname];
    }

    set value(newValue: any) {
        this.state[this.propname] = newValue;
        this.onset && this.onset(this);
        this.watchers.forEach(w => w(this));
    }

    watch(watcher: PropertyWatcher) {
        this.watchers.push(watcher);

        return () => this.watchers = this.watchers.filter(x => x !== watcher);
    }

    /**
     * Immediately invokes any bound `PropertyWatcher`s.
     */
    on_changed() {
        this.onset && this.onset(this);
        this.watchers.forEach(w => w(this));
    }

    wrapped(getter?: (value:any)=>any, setter?: (value:any)=>any): Property {
        return new WrappedProperty(this, getter, setter, this.onset);
    }

    navigate(key: StateKey): Property {
        return new NavigatedProperty(this, key, this.onset);
    }
}

/**
 * Wraps another property with two map-like functions.
 * Useful for converting between application and view data.
 */
export class WrappedProperty implements Property {
    constructor(public base: Property, protected getter?: (value:any)=>any, protected setter?: (value:any)=>any, protected onset?: PropertyWatcher) { }

    get propname() {
        return this.base.propname;
    }

    get value(): any {
        return this.getter ? this.getter(this.base.value) : this.base.value;
    }

    set value(newValue: any) {
        this.base.value = this.setter ? this.setter(newValue) : newValue;
        this.onset && this.onset(this);
    }

    watch(watcher: (self:any)=>void) {
        return this.base.watch(() => watcher(this));
    }

    wrapped(getter?: (value:any)=>any, setter?: (value:any)=>any): Property {
        return new WrappedProperty(this, getter, setter, this.onset);
    }

    navigate(key: StateKey): Property {
        return new NavigatedProperty(this, key, this.onset);
    }
}

/**
 * Accesses a value in another property's value. Should only be used on a property that stores an object.
 */
export class NavigatedProperty extends WrappedProperty implements Property {
    /**
     * Creates a new NavigatedProperty.
     * @param base The base property to wrap.
     * @param key The value to access in the base property's value.
     * @param onset Called when this property is set.
     */
    constructor(public base: Property, public key: StateKey, onset?: PropertyWatcher) {
        super(base, obj => obj[this.key], value => ({...base.value, [key]: value}), onset);
    }

    get propname() {
        return this.key;
    }

    /**
     * Deletes this object from the wrapped property using a delete statement.
     */
    delete() {
        const obj = this.base.value;

        delete obj[this.key];

        this.base.value = obj;
    }

    /**
     * Deletes this object from the wrapped property using `value.filter`.
     */
    deleteByFilter() {
        const { value } = this;

        this.base.value = this.base.value.filter(x => x !== value);
    }
}

export type StateGraphPropertyWatcher = (state: StateGraph, propname: StateKey)=>void;

export class StateGraph {

    /**
     * A plain-old-javascript-object containing all the state in this graph.
     * May have getters & setters set.
     */
    public readonly state: StateMap = {};

    public push_default_mode: "fast" | "accurate" = "accurate";

    private derivers: {[name: StateKey]: ExplicitlyDerived} = {};
    private deps: {[name: StateKey]: StateKey[]} = {};

    private global_watchers: StateGraphPropertyWatcher[] = [];
    private watchers: {[name: StateKey]: StateGraphPropertyWatcher[]} = {};

    private props: {[name: StateKey]: Property} = {};
    private extern: {[name: StateKey]: Property} = {};

    constructor(args: StateGraphArgs) {
        this.derivers = {
            ...Object.fromEntries(Object.entries(args.derivers || {})
                .filter(([_, value]) => Boolean(value))
                .map(([name, value]) => {
                    if(typeof(value) === "function") {
                        return [name, ExtractDeriver(value)];
                    } else {
                        return [name, value];
                    }
                })
            ),
            
            ...Object.fromEntries(Object.entries(args.requests || {})
                .filter(([_, value]) => Boolean(value))
                .map(([name, value]) => {
                    if(typeof(value) === "function") {
                        return [name, {
                            ...ExtractDeriver(value),
                            is_request: true
                        }];
                    } else {
                        return [name, {
                            ...value,
                            is_request: true
                        }];
                    }
                })
            )
        };

        Object.entries(args.properties || {})
            .filter(([_, value]) => Boolean(value))
            .forEach(([name, value]) => {
                Object.defineProperties(this.state, {
                    [name]: {
                        get: () => value.value,
                        set: (newValue) => value.value = newValue,
                        enumerable: true
                    }
                });
                this.extern[name] = value;
                value.watch(() => {
                    this.dispatch_change(name);

                    const d = this.deps[name];
                    d && this.push(Object.fromEntries(d.map(dep => [dep, this.state[dep]])));
                });
            });

        for (const name in this.derivers) {
            if (Object.prototype.hasOwnProperty.call(this.derivers, name)) {
                const deriver = this.derivers[name];
                
                for (const dep of deriver.params) {
                    const a = (this.deps[dep] = (this.deps[dep] || []));

                    a.push(name);
                }
            }
        }

        args.defaults && this.push(args.defaults);
    }

    prop(name: StateKey) {
        if(!this.props[name]) {
            this.props[name] = new StateGraphProperty(this, name);
        }

        return this.props[name];
    }

    watch(name: StateKey, watcher: StateGraphPropertyWatcher): ()=>void {
        const a = (this.watchers[name] = (this.watchers[name] || []));

        a.push(watcher);

        return () => this.watchers[name] = this.watchers[name].filter(x => x !== watcher);
    }

    watch_all(watcher: StateGraphPropertyWatcher): ()=>void {
        this.global_watchers.push(watcher);

        return () => this.global_watchers = this.global_watchers.filter(x => x !== watcher);
    }

    push(newState: StateMap, mode: "fast" | "accurate" | null = null) {
        if((mode || this.push_default_mode) == "fast") {
            return this.push_fast(newState);
        } else {
            return this.push_accurate(newState);
        }
    }

    push_fast(newState: StateMap) {
        const visited: StateKey[] = [];
        const queue: StateKey[] = Object.keys(newState);

        Object.assign(this.state, newState);

        while(queue.length > 0) {
            const n = queue[0];
            queue.splice(0, 1);
            visited.push(n);

            this.update(n, newState);

            const dep = this.deps[n];

            if(dep) {
                dep.forEach(_d => queue.push(_d));
            }
        }

        return visited;
    }

    push_accurate(newState: StateMap) {
        const to_be_updated: Set<StateKey> = new Set<StateKey>();

        const queue: StateKey[] = Object.keys(newState);

        while(queue.length > 0) {
            const front = queue[0];
            to_be_updated.add(front);
            queue.splice(0, 1);

            const dep = this.deps[front];
            if(dep) {
                dep.filter(d => !to_be_updated.has(d)).forEach(d => queue.push(d));
            }
        }

        const order: StateKey[] = [];

        const canUpdate = (key: StateKey) => this.derivers[key] ?
            this.derivers[key].params.map(d => !to_be_updated.has(d)).reduce((acc, x) => acc && x, true) :
            true;

        Object.assign(this.state, newState);

        while(to_be_updated.size > 0) {
            var any_updated = false;

            for (const u of to_be_updated) {
                if(canUpdate(u)) {
                    this.update(u, newState);
                    order.push(u);
                    to_be_updated.delete(u);
                    any_updated = true;
                }
            }

            if(!any_updated) {
                break;
            }
        }

        if(to_be_updated.size > 0) {
            // none of the derivers which are dependant on these changes can be updated
            // which means there's a circular reference between them
            // so just update them once, sorted by the given order (or their names, if none set)
            const update = [...to_be_updated];
            update.sort((a, b) => (this.derivers[a]?.order || String(a)).localeCompare(this.derivers[b]?.order || String(b)));

            for (const u of update) {
                this.update(u, newState);
                order.push(u);
                to_be_updated.delete(u);
            }
        }

        return [...order];
    }

    update(key: StateKey, newState: StateMap) {
        const d = this.derivers[key];

        if(d) {
            if(d.is_request) {
                if(key in newState) {
                    this.dispatch_change(key);
                } else {
                    const x: Promise<StateValue> = d.func(this.state, this);

                    if(x) {
                        x.then(value => {
                            this.push({[key]: value});
                        }).catch(reason => {
                            console.error(reason);
                        });
                    }
                }
            } else {
                this.state[key] = d.func(this.state, this);
                this.dispatch_change(key);
            }
        }
    }

    private dispatch_change(key: StateKey) {
        const w = this.watchers[key];
        w && w.forEach(watcher => watcher(this, key));

        this.global_watchers.forEach(watcher => watcher(this, key));
    }
};
