const path = require("node:path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { checkTypes } = require("./scripts/check-types.cjs");

class TypePolicyPlugin {
  apply(compiler) {
    compiler.hooks.beforeRun.tap("TypePolicyPlugin", checkTypes);
    compiler.hooks.watchRun.tap("TypePolicyPlugin", checkTypes);
  }
}

const shared = {
  context: __dirname,
  target: ["web", "es2022"],
  devtool: "source-map",
  resolve: { extensions: [".ts", ".js"], extensionAlias: { ".js": [".ts", ".js"] } },
  module: { rules: [{
    test: /\.ts$/, exclude: /node_modules/,
    use: { loader: "ts-loader", options: { configFile: "tsconfig.runtime.json", compilerOptions: { declaration: false, noEmit: false } } }
  }] },
  stats: "errors-warnings"
};

module.exports = [{
  ...shared,
  name: "runtime",
  entry: { player: "./src/runtime/index.ts" },
  experiments: { outputModule: true },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "runtime/[name].js",
    chunkFilename: "runtime/chunks/[name].[contenthash:8].js",
    library: { type: "module" }, module: true,
    chunkFormat: "module", chunkLoading: "import", publicPath: "auto",
    clean: { keep: /^runtime\/bootstrap\.js(?:\.map)?$/ }
  },
  plugins: [new TypePolicyPlugin(), new CopyWebpackPlugin({ patterns: [
    { from: "src/player/index.html", to: "index.html" },
    { from: "src/player/styles", to: "styles" },
    { from: "LICENSE{,-MIT,-APACHE}", to: "[name][ext]" },
    { from: "**/*.{json,png,mp3}", context: path.resolve(__dirname, "assets"), to: "assets/[path][name][ext]" }
  ] })],
  optimization: { splitChunks: { chunks: "async", cacheGroups: {
    babylon: { test: /[\\/]node_modules[\\/]@babylonjs[\\/]/, name: "babylon-core", enforce: true }
  } } },
  performance: { hints: false }
}, {
  ...shared,
  name: "bootstrap", dependencies: ["runtime"],
  entry: "./src/player/bootstrap.ts",
  output: { path: path.resolve(__dirname, "dist"), filename: "runtime/bootstrap.js" }
}];
