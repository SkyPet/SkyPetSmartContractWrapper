const Web3 = require('web3');
const os=require('os');
const child_process = require('child_process');
const uuid = require('node-uuid');
const url = require('url');
const path = require('path');
const fs=require('fs');
const metaData=require('./SkyPet.json');
const pkginfo = require('pkginfo')(module, 'name');
const testing=process.env.gethProduction?false:true;
const gethPath=path.join(process.env.gethPath?process.env.gethPath:os.homedir(), ".ethereum");
const gethLocations={
  production:gethPath,
  testing:path.join(gethPath, 'testnet')
};
const network=testing?"3":"1";//3 is ropsten, 1 is live
var web3=new Web3();
const getGethPath=(fileName, isTest)=>{
  return path.join(isTest?gethLocations.testing:gethLocations.production, fileName);
}
const ipcPath=getGethPath('geth.ipc', testing);
const ethPath=getGethPath("", false);
const datadir=getGethPath(path.join('geth', 'lightchaindata'), testing);
const contractAddress=metaData.networks[network].address;
const abi=metaData.abi;


/**Utility function for an async for-loop */
const iterateAsyncArray=(n, cb)=>{
    const results=Array(n).fill(0).map((val, index)=>{
        return new Promise((resolve, reject)=>{
            cb(resolve, reject, index);
        }).then((value)=>{
            return value;
        })
    });
    return Promise.all(results);
}
/**Wrapper for two of the contract functions.  First, it gets the total number of attributes for the given hash, and second it retreives the attribute for each index.  Contract is the instance of the smart contract, hashId is the hash identifying the pet, and callback takes three arguments: resolve, reject from the Promise and index for the location of the attribute*/
const getAttributes=(contract, hashId, cb)=>{
    contract.getNumberOfAttributes(hashId, (err, result)=>{
        const maxIndex=result.c[0];
        iterateAsyncArray(maxIndex, (resolve, reject, index)=>{
            contract.getAttribute(hashId, index, (err, result)=>{
                resolve({value:result[1], timestamp:new Date(result[0].c[0]*1000)});
            });
        }).then(results=>{cb(null, results)}).catch(e=>{cb(e, null)});

    });
}
/**Simple wrapper for the costToAdd contract function. Converts results to ether and in string format */
const getCost=(contract, cb)=>{
    contract.costToAdd((err, result)=>{
        return err?cb(err, null):cb(null, web3.fromWei(result).toString());
    });
}
/**Gets cost, current balance, unlocks account, and uploads the attribute.  */
const addAttribute=(password, message, hashId, contract, cb)=>{
    const msToKeepAccountUnlocked=3000;
    contract.costToAdd((err1, cost)=>{
        web3.eth.getBalance(web3.eth.defaultAccount, (err2, balance)=>{
            if(cost.greaterThan(balance)){
                return cb("Not enough Ether!", null);
            }
            web3.personal.unlockAccount(web3.eth.defaultAccount, password, msToKeepAccountUnlocked, (err3, arg)=>{
                return err3?cb("Incorrect Password", null):contract.addAttribute.sendTransaction(hashId, message,
                {value:cost, gas:3000000}, (err, results)=>{
                    return err?cb(err, null):cb(null, results);
                });
            });
        })
    });
}
/**Sets up watcher for the contract.  If anything happens to the attributes associated with the hashID then updates the attributes values and updates the money available.  Note that this is doesn't alter anything in the contract, but simply is a utility function to alert the UI for changes */
const watchContract=(contract, hashId,  attributeCB, moneyCB)=>{
    contract.attributeAdded({_petid:hashId}, (error, result)=>{
        if(error){
            return cb(error, null);
        }
        getAttributes(contract, hashId, attributeCB);
        getMoneyInAccount(web3.eth.defaultAccount, moneyCB);
    });
}
const getContract=()=>{
    return web3.eth.contract(abi).at(contractAddress);
}
/**Function which checks if password is correct.  This shouldn't be used frequently if at all since the only purpose for unlocking the account is when conducting a transaction and if the password fails in the transaction there already exists a callback which can alert the user.  See addAttribute for an example.  */
const checkPassword=(password, cb)=>{
    const msToKeepAccountUnlocked=1;
    web3.personal.unlockAccount(web3.eth.defaultAccount, password, msToKeepAccountUnlocked, (err, arg)=>{
        return err?cb(err, null):cb(null, arg);
    });
}

const createAccount=(password, cb)=>{
    web3.personal.newAccount(password, (err, arg)=>{
        return err?cb(err, null):cb(null, arg);
    })
}
/**Retrieves first account in account list */
const getAccounts=(cb)=>{
  web3.eth.getAccounts((err, result)=>{
    if(err||result.length===0){
       return cb(err||"error", null); 
    }
    else{
        web3.eth.defaultAccount=result[0];
        return cb(null, result[0]);
    }
  });
}
const getMoneyInAccount=(address, cb)=>{
    web3.eth.getBalance(address, (err, balance)=>{ 
        err?cb(err, null):cb(null, web3.fromWei(balance).toString());
    });
}
/**wrapper for ethereum sync.  callbacks execute on (0-100 scale) and on finish */
const getSync=(progressCB, endCB)=>{
    web3.eth.isSyncing((error, sync)=>{
        console.log(error);
        if(sync===true){
            console.log("syncing started");
        }
        else if(sync){
            var progress=100.0*(sync.currentBlock-sync.startingBlock)/(sync.highestBlock-sync.startingBlock);
            progressCB(progress);
        }
        else{
            console.log("sync complete");
            endCB();
        }
    });
}
/**Spawns geth and opens web3.  Defaults to localhost:8545.  This should never be called from a public HTTP request! */
const getEthereumStart=(gethCommand, cb, port=8545)=>{
    const commands=['--rpc', '--datadir='+getGethPath("", false), '--light', '--ipcpath='+ipcPath, '--rpcapi="db,eth,net,personal,web3"', `--rpcport=${port}`];
    var geth = child_process.spawn(gethCommand, testing?commands.concat([ '--testnet']):commands);
    const wrappedCallback=()=>{
        geth.stderr.removeAllListeners();
        web3.setProvider(new web3.providers.HttpProvider(`http://localhost:${port}`));
        cb(geth);
    }   
    //geth sends data on stderr pipe instead of stdout
    geth.stderr.on('data', wrappedCallback);
}

const closeGeth=(geth)=>{
    geth.kill();
}
exports.addAttribute=addAttribute;
exports.getAttributes=getAttributes;
exports.getEthereumStart=getEthereumStart;
exports.getSync=getSync;
exports.createAccount=createAccount;
exports.closeGeth=closeGeth;
exports.getAccounts=getAccounts;
exports.checkPassword=checkPassword;
exports.getMoneyInAccount=getMoneyInAccount;
exports.getContract=getContract;
exports.getCost=getCost;
exports.watchContract=watchContract;