const { expect } = require('code');
const Lab = require('lab');
const { after, before, describe, it } = exports.lab = Lab.script();

const Http = require('http');
const Disconsulate = require('../');


describe('getService', async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      request = req;
      res.end(JSON.stringify([
        { Service: { Address: 'configured.com', Port: '1234' } },
      ]));
    });

  before( async () => {
    await server.listen(0);
    const client = new Disconsulate({ consul: `http://localhost:${server.address().port}` });
    await client.getService("foo");
  });


  it('calls the configured address', () => {
      expect(request).to.not.be.null();
  });

  it('calls the health endpoint', () => {
    expect(request.url).to.equal('/v1/health/service/foo');
  })
});


describe('When using environment variables', async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      request = req;
      res.end(JSON.stringify([
        { Service: { Address: 'configured.com', Port: '1234' } },
      ]));
    });

  before( async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("bar");
  });

  after ( async () => {
     delete process.env.CONSUL_ADDR;
  })


  it('calls the configured endpoint', () => {
      expect(request).to.not.be.null();
  });

  it('calls the health endpoint', () => {
    expect(request.url).to.equal('/v1/health/service/bar');
  })
});
