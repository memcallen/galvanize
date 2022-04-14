Galvanize is a state management library for web applications \([and is totally going to replace Redux, trust me](https://xkcd.com/927/) ^/s\).

Galvanize's goal is to plug the management hole for component-level state. For global application state, Redux works extremely well, but when an app needs to have component-level state, Redux needs a lot of workarounds to implement cleanly. When using Redux for component state, care must also be taken to properly manage the lifetime of the state. If the state has to be shared between /multiple/ components, it gets even worse. In theory, a programmer could use the react mount and unmount hooks to initialize and reset the state, but often times that isn't the case. Creating or modifying an app's state code shouldn't require extreme amounts of diligence; we use memory-managed languages for this exact reason.

With Galvanize, component state is defined by a single object, similar to Redux. Rather than using reducers, Galvanize uses a series of pure functions to derive state from previous defined values. If deriver B depends on the state A, and state A updates, so will deriver B. This can be used to create state graphs. Every state variable in Galvanize is called a property, and should be interacted with via a proxy object, so that the graph is notified about changes.

The dependencies for all derivers are automatically determined at runtime, although it's also possible to hardcode the dependencies by passing a plain-old-javascript-object to the 

## Example State Graph

```javascript
const state = new StateGraph({
    defaults: {
        A: 0,
    },
    derivers: {
        B: ({ A }) => A + 5
    }
});
```

In the above state graph, the properties A and B exist on the state object. New values of A are pushed using `state.push({A: ...})`, which will cause B to update accordingly. The `push` method is similar to React's `setState`. It essentially just calls `Object.assign`, and updates any derivers which depend on the changed state (recursively).

Properties can either be access directly, via `state.state.B`, or by the property object, which is the recommended usage.

```javascript
const A = state.prop("A");
const B = state.prop("B");

A.value = 5;
console.assert(B.value === 10); // passes

```

The main purpose of the property object is to be passed to children components. For example, if we have a page component which to show data, and a child component which renders an editable table, we can pass the data property to the table component. The table component can update whatever data it needs, causing whatever needs to be updated in the parent component to also update.
