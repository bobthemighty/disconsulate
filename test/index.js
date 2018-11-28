const { expect, fail } = require("code");
const Lab = require("lab");
const { after, before, describe, it } = (exports.lab = Lab.script());

const Http = require("http");
const Disconsulate = require("../");

describe("getService", async () => {
  let request = null;
  let result = null;
  let client = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([
        { Service: { Address: "10.0.0.1", Port: "1234" } },
        { Service: { Address: "10.0.0.2", Port: "2345" } }
      ])
    );
  });

  before(async () => {
    await server.listen(0);
    client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });
    result = await client.getService("foo");
  });

  it("calls the configured address", () => {
    expect(request).to.not.be.null();
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal("/v1/health/service/foo?passing=1&near=agent");
  });

  it("returns the first of the registered services", () => {
    expect(result.Address).to.equal("10.0.0.1");
    expect(result.Port).to.equal("1234");
  });

  it("cycles through all registered services when asked again", async () => {
    let result = await client.getService("foo");
    expect(result.Address).to.equal("10.0.0.2");
    expect(result.Port).to.equal("2345");

    result = await client.getService("foo");
    expect(result.Address).to.equal("10.0.0.1");

    result = await client.getService("foo");
    expect(result.Address).to.equal("10.0.0.2");
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
    expect(request.url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&dc=eu-west-1&tag=active&tag=release-123"
    );
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
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
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

describe("When the response is large", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    let data = [];
    for (let i = 0; i < 10000; i++) {
      data.push({
        Service: {
          Address: "machine-" + i,
          port: i
        }
      });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(JSON.stringify(data));
  });

  before(async () => {
    await server.listen(0);
    const client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });
    await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
  });
});

describe("When the server fails with error text", () => {
  const server = Http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("That didn't work");
  });

  before(async () => {
    await server.listen(0);
  });

  it("propagates the error", async () => {
    const client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {
      expect(e.message).to.endWith(
        "/v1/health/service/some-service?passing=1&near=agent: That didn't work"
      );
    }
  });
});

describe("When the server fails", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    request = req;
    res.end();
  });

  before(async () => {
    await server.listen(0);
  });

  it("propagates the error", async () => {
    const client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When there is no server", () => {
  let request = null;

  it("propagates the error", async () => {
    const client = new Disconsulate({
      consul: "http://consul.invalid"
    });

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When we receive no services", async () => {
  let request = null;
  let result = null;
  let client = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end("[]");
  });

  before(async () => {
    await server.listen(0);
    client = new Disconsulate({
      consul: `http://localhost:${server.address().port}`
    });
  });

  it("Fails with an error", async () => {
    try {
      result = await client.getService("foo");
      fail("Expected failure but received result " + JSON.stringify(result));
    } catch (e) {}
  });

});
