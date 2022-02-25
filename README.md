# crust-nft-storage
Save all nftscan's data on Crust

## Start up

### Start watcher 

Please allow your ***30888*** port by running(on ubuntu):
```
sudo ufw allow 30888
```

At project root directory run:
```
sudo docker-compose -f docker/watch-chain.yaml up -d
```
to start a watcher for order and wait for chain synchronization complete. You can use '***sudo docker logs crust-watch -f***' to see syncing progress

### Bootstrap configure 
***.env*** file needs to be created in the project root directory, a sample ***.env*** file shows as follow:
```
CRUST_SEEDS="xxxxxxxx"
CHAIN_ADDR="ws://localhost:19944"
NFT_LIST_URL="http://<xxx>/ipfs/getNftList"
NFT_UPDATETOKENURI_URL="http://<xxx>/ipfs/updateTokenUri"
NFT_UPDATESTATUS_URL="http://<xxx>/ipfs/updateStatus"
NFT_DOWNLOAD_TIMEOUT=180000
IPFS_TIMEOUT="120s"
IPFS_HOMEDIR="/tmp/crust/.ipfs"
SERVER_PORT=8765
```

1. CRUST_SEEDS: required, Crust network account seeds
1. CHAIN_ADDR: required, Crust network address, you can use the watcher started in previous step which is '***ws://localhost:19944***'
1. NFT_LIST_URL: required, get NFTs
1. NFT_UPDATETOKENURI_URL: required, update nft token uri
1. NFT_UPDATESTATUS_URL: required, update nft address status
1. NFT_DOWNLOAD_TIMEOUT: optional, nft download timeout, default is 180s
1. IPFS_TIMEOUT: optional, ipfs operation timeout, default is 120s
1. IPFS_HOMEDIR: required, ipfs home directory
1. SERVER_PORT: required, server listen port, default is 8765

### Start service
```
yarn build && yarn start
```

## APIs

### '/process' API

```
curl -XPOST 'http://localhost:<port>/api/v0/process?address=xxx&orderNumLimit=xxx&sync=false'
```

#### Description
Order nfts

#### Parameter
1. address [string]: required, transaction hash
1. orderNumLimit [number]: optional, max total file number limit per order, default is 500
1. sync [boolean]: optional, 'true' starts a sync request while 'false' does an async one, default is false

#### Output
```
{
    "statusCode": 200,
    "message": "task(address:xxx) added successfully"
}
```

### '/progress' API

```
curl -XGET 'http://localhost:<port>/api/v0/progress'
```

#### Description
Check running task information

#### Output:
```
{
    "address": "xxxx",
    "total": 1000,
    "complete": 500,
    "remaining": 500,
    "completeOrder": [
        "xxx1",
        "xxx2",
        "xxx3",
        "xxx4"
    ]
}
```

### '/replica' API

```
curl -XGET 'http://localhost:<port>/api/v0/replica?cid=xxx'
```

#### Description
Get indicated order's replica through Crust network

#### Parameter
1. cid [string]: required, IPFS content id

#### Output
```
{
    "cid": "xxx",
    "replica": 100
}
```

### '/stop' API

```
curl -XGET 'http://localhost:<port>/api/v0/stop'
```

#### Description
Stop current task

#### Output
```
{
    "statusCode": "xxx",
    "message": "xxx"
}
```
