const path = require('path');
const webpack = require('webpack');
const ENV = require('./env');

module.exports = {
	mode: "development",
	entry: "./src/galvanize.ts",
  devtool: "source-map",

	output: {
    library: "galvanize",
    libraryTarget: "umd",
    filename: "galvanize.js",
		path: path.resolve(__dirname, 'lib'),
  },
	
  resolve: {
		extensions: [ '.ts', '.js' ],
  },
	
  plugins: [
		new webpack.EnvironmentPlugin(ENV),
  ],
	
	module: {
		rules: [
      {
        test: /\.(tsx?|jsx?)$/,
        use: [
          'babel-loader',
        ],
        exclude: /node_modules/,
      },
		]
	}
}
