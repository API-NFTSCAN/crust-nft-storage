import NFTScan from './nftscan';

const http = require('http');
const port = 8765

async function main() {
  const ni = new NFTScan()
  await ni.init();

  // Create a local server to receive data from
  const server = http.createServer();

  // Listen to the request event
  server.on('request', async (req: any, res: any) => {
    let url = new URL(req.url, `http://${req.headers.host}`)
    let resCode = 200
    let resBody = {}
    let resMsg = ''
    if ('/process' === url.pathname) {
      const tx = url.searchParams.get('tx')
      const orderNumLimit = url.searchParams.get('orderNumLimit')
      const orderSizeLimit = url.searchParams.get('orderSizeLimit')
      if (tx !== null) {
        const runningTask = ni.getRunningTask()
        if (runningTask !== '') {
          resMsg = `another process(tx:${runningTask}) is running`
          resCode = 400
        } else {
          if (orderNumLimit !== null) { 
            ni.setOrderNumLimit(parseInt(orderNumLimit)) 
          }
          if (orderSizeLimit !== null) { 
            ni.setOrderSizeLimit(parseInt(orderSizeLimit))
          }
          ni.requestProcess(tx)
          resMsg = `task(tx:${tx}) added successfully`
        }
      } else {
        resMsg = 'illegal parameter, need parameter:tx'
        resCode = 500
      }
    } else if ('/progress' === url.pathname) {
      const info = ni.getProcessInfo()
      if (info['tx'] === '') {
        resMsg = 'no task is running'
      } else {
        resBody = info
      }
    } else if ('/chainConfig' === url.pathname) {
      resBody = ni.chain.getChainConfig()
    } else if ('/configChain' === url.pathname) {
      const chainAddr = url.searchParams.get('chainAddr')
      const ipfsGateway = url.searchParams.get('ipfsGateway')
      resMsg = 'Set'
      if (chainAddr !== null) {
        ni.chain.setChainAddr(chainAddr)
        console.log(`Set chain address to:${chainAddr}`)
        resMsg += ' chain address'
      }
      if (ipfsGateway !== null) {
        ni.chain.setIPFSGateway(ipfsGateway)
        console.log(`Set ipfs gateway to:${ipfsGateway}`)
        resMsg += ' ipfs gateway'
      }
      if (resMsg === 'Set') {
        resMsg += ' successfully'
      } else {
        resMsg = 'Invalid parameter'
        resCode = 400
      }
    } else {
      resMsg = `unknown request:${url.pathname}`
      resCode = 404
    }
    if (resMsg !== '') {
      resBody = {
        statusCode: resCode,
        message: resMsg
      }
    }
    res.writeHead(resCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resBody));
  });

  server.listen(port);
  console.log(`Start server on port:${port} successfully`)
}

main()
