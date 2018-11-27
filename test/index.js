const { expect } = require('code');
const Lab = require('lab');
const { after, before, describe, it } = exports.lab = Lab.script();

const Http = require('http');
const Disconsulate = require('../');


describe('configuration', async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      request = req;
      res.end(JSON.stringify([
        { Service: { Address: 'configured.com', Port: '1234' } },
        { Service: { Address: 'configured.com', Port: '1234' } }
      ]));
    });

  before( async () => {
    await server.listen(0);
    const client = new Disconsulate({ consul: `http://localhost:${server.address().port}` });
    await client.getService("foo");
  });


  it('sets the consul address then uses it for requests to consul', async () => {
      expect(request).to.not.be.null();
  });

  it('calls the health endpoint', () => {
    expect(request.url).to.equal('/v1/health/service/foo');
  })
});
