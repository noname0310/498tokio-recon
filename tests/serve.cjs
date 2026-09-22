const { makeServer, root } = require("../scripts/serve.cjs");
const path = require("node:path");
module.exports = { root, makeServer: options => makeServer({ mounts: [{ prefix: "/tests/fixtures/", directory: path.join(root, "tests/fixtures") }], ...options }) };
