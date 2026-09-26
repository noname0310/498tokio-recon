const path = require("node:path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const HtmlInlineScriptPlugin = require("html-inline-script-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

const shared = {
  context: __dirname,
  target: ["web", "es2022"],
  devtool: "source-map",
  resolve: { extensions: [".ts", ".js"], extensionAlias: { ".js": [".ts", ".js"] } },
  module: { rules: [{
    test: /\.ts$/, exclude: /node_modules/,
    use: { loader: "ts-loader", options: { compilerOptions: { declaration: false, noEmit: false } } }
  }] },
  stats: "errors-warnings"
};

const site = {
  ...shared,
  name: "site",
  entry: {
    player: { import: "./src/runtime/index.ts", library: { type: "module" } },
    bootstrap: { import: "./src/player/bootstrap.ts", dependOn: "player" }
  },
  experiments: { outputModule: true },
  module: { rules: [
    ...shared.module.rules,
    { test: /\.html$/, use: { loader: "html-loader", options: { sources: false, minimize: false } } }
  ] },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "runtime/[name].js",
    chunkFilename: "runtime/chunks/[name].[contenthash:8].js",
    module: true,
    chunkFormat: "module", chunkLoading: "import", publicPath: "auto",
    clean: { keep: /^standalone\// }
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "src/player/index.html", scriptLoading: "module", inject: "body", chunks: ["player", "bootstrap"], minify: false }),
    new CopyWebpackPlugin({ patterns: [
    { from: "src/player/styles", to: "styles" },
    { from: "LICENSE{,-MIT,-APACHE}", to: "[name][ext]" },
    { from: "**/*.{json,png,m4a,woff2,css,txt}", context: path.resolve(__dirname, "assets"), to: "assets/[path][name][ext]" }
  ] })],
  optimization: { splitChunks: { chunks: "async", cacheGroups: {
    babylon: { test: /[\\/]node_modules[\\/]@babylonjs[\\/]/, name: "babylon-core", enforce: true }
  } } },
  performance: { hints: false }
};
const standalone = {
  ...shared,
  name: "standalone", devtool: false,
  entry: "./src/player/standalone.ts",
  output: { path: path.resolve(__dirname, "dist/standalone"), filename: "player.js", publicPath: "", clean: true },
  resolve: { ...shared.resolve, alias: {
    "./create-texture-worker.js$": path.resolve(__dirname, "src/player/create-inline-texture-worker.ts")
  } },
  module: { rules: [
    { resourceQuery: /^\?inline-worker$/, use: { loader: "worker-rspack-loader", options: { inline: "no-fallback" } } },
    ...shared.module.rules,
    { test: /\.png$/, type: "asset/inline" },
    { test: /\.woff2$/, type: "asset/inline", generator: { dataUrl: { mimetype: "font/woff2" } } },
    { test: /\.m4a$/, type: "asset/inline", generator: { dataUrl: { mimetype: "audio/mp4" } } },
    { resourceQuery: /^\?source$/, type: "asset/source" }
  ] },
  plugins: [
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new HtmlWebpackPlugin({ template: "src/player/standalone.html", scriptLoading: "blocking", inject: "body", minify: false }),
    new HtmlInlineScriptPlugin()
  ],
  optimization: { splitChunks: false, runtimeChunk: false, minimizer: [new TerserPlugin({ extractComments: false })] },
  performance: { hints: false }
};
module.exports = (env = {}) => env.standalone
  ? [standalone]
  : env.site ? [site] : [site, { ...standalone, dependencies: ["site"] }];
