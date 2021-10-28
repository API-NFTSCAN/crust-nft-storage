'use strict'
import { create, globSource } from 'ipfs'

const Ctl = require('ipfsd-ctl')
const all = require('it-all')
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { typesBundleForPolkadot, types } = require('@crustio/type-definitions');
const { checkCid, checkSeeds, sendTx } = require('./utils')
const { concat: uint8ArrayConcat } = require('uint8arrays/concat')
const { fromString: uint8ArrayFromString } = require('uint8arrays/from-string')
const { toString: uint8ArrayToString } = require('uint8arrays/to-string')
const https = require('https'); // or 'https' for https:// URLs
const fs = require('fs');
const path = require('path')
const example_urls = ["https://asset.maonft.com/rpc/4999.png", "https://asset.maonft.com/rpc/4992.png"]

interface ipfsElem {
    cid: string;
    size: number;
}

class NFTScan {
    private ipfsClient: any;
    private addOption: object = {
        pin: true,
        wrapWithDirectory: true,
        timeout: 10000
    }
    private globSourceOptions = {
        recursive: true
    }
    private uploadFiles = new Map()

    async DownloadFile(urls: Array<string>)
    {
        let resPromise = []
        for (const url of urls)
        {
            resPromise.push(new Promise((resolve, reject) => {
                https.get(url, function(res: any) {
                    const file_name = path.basename(url)
                    const file = fs.createWriteStream("nfts/" + file_name);
                    res.pipe(file);
                    console.log(`   Download file ${file_name} successfully`)
                    resolve(res)
                })
            }));
        }
        if (resPromise.length != 0)
        {
            console.log('=> Downloading files...')
            for ( let p of resPromise)
            {
                await p
            }
            console.log('=> Download files end')
        }
    }

    async Init () {
        await this.StartIPFS()
        const version = await this.ipfsClient.version()
        console.log('Version:', version.version)
    }

    async UploadFile() {
        console.log('=> Uploading files...')
        for await (const file of this.ipfsClient.addAll(globSource('/home/yaoz/nftscan-saver/nfts', '**/*'), this.addOption)) {
            if (file.path != '')
            {
                console.log(`   Upload file:'${file.path}' cid:'${file.cid}' successfully`)
            }
            this.uploadFiles.set(file.path, {
                cid: file.path,
                size: file.size
            })
        }
        console.log('=> Upload file end')
        //console.log('Added file:', file.path, file.cid.toString())
        //const data = uint8ArrayConcat(await all(this.ipfs.cat(file.cid)))
        //console.log('Added file contents:', uint8ArrayToString(data))
    }

    async StartIPFS() {
        const ipfsd = await Ctl.createController({
            ipfsHttpModule: require('ipfs-http-client'),
            ipfsBin: require('ipfs').path()
        })
        const id = await ipfsd.api.id()
        this.ipfsClient = ipfsd.api
        console.log(id)
    }

    async OrderFiles(cid: string, size: number, seeds: string, chainAddr: string, ipfsGateway: string) {
        // 1. Check cid and seeds
        if (!checkCid(cid) || !checkSeeds(seeds)) {
            throw new Error('Illegal inputs');
        }

        // 2. Try to connect to Crust Chain
        const chain = new ApiPromise({
            provider: new WsProvider(chainAddr),
            typesBundle: typesBundleForPolkadot
        });
        await chain.isReadyOrError;

        // 3. Get file size by hard code instead of requsting ipfs.gateway(leads timeout)
        // const ipfs = axios.create({
        //     baseURL: ipfsGateway + '/api/v0',
        //     timeout: 60 * 1000, // 1 min
        //     headers: {'Content-Type': 'application/json'},
        // });
        // const res = await ipfs.post(`/object/stat?arg=${cid}`);
        // const objInfo = parseObj(res.data);
        // const size = objInfo.CumulativeSize;
        // console.log(`Got IPFS object size: ${size}`);

        // 4. Construct tx
        const tx = chain.tx.market.placeStorageOrder(cid, size, 0, '');

        // 5. Send tx and disconnect chain
        const txRes = await sendTx(tx, seeds);
        chain.disconnect();

        console.log('res:' + txRes);
    }

    async UpdateUpstream() {
        console.log('Updating upstream status...')
    }
}

async function main() {
    const nftscanInst = new NFTScan()
    await nftscanInst.Init()
    await nftscanInst.DownloadFile(example_urls)
    await nftscanInst.UploadFile()
}

main()
