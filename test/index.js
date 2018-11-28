const { expect } = require("code");
const Lab = require("lab");
const { after, before, describe, it } = (exports.lab = Lab.script());

const Http = require("http");
const Disconsulate = require("../");

describe("getService", async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    const client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });
    await client.getService("foo");
  });

  it("calls the configured address", () => {
    expect(request).to.not.be.null();
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal("/v1/health/service/foo?passing=1&near=agent");
  });
});

describe("When specifying additional options", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("baz", {
      tags: ["active", "release-123"],
      dc: "eu-west-1"
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal("/v1/health/service/baz?passing=1&near=agent&dc=eu-west-1&tag=active&tag=release-123");
  });


});

describe("When specifying node metadata", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro",
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal("/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro");
  });


});




describe("When using environment variables", async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("bar");
  });

  after(async () => {
    delete process.env.CONSUL_ADDR;
  });

  it("calls the configured endpoint", () => {
    expect(request).to.not.be.null();
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.startWith("/v1/health/service/bar");
  });
});
