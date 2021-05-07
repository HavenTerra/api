const express = require('express');
const cors = require('cors');
const app = express();
const { user } = require("./models");
const axios = require('axios').default
const { LCDClient, MsgSend, MnemonicKey, Wallet  } = require('@terra-money/terra.js');
const {Anchor, tequila0004, AddressProviderFromJson, MARKET_DENOMS} = require('@anchor-protocol/anchor.js');


// Vars
const addressProvider = new AddressProviderFromJson(tequila0004);
const terra = new LCDClient({ URL: 'https://tequila-lcd.terra.dev', chainID:'tequila-0004', gasAdjustment: 2 });
const anchor = new Anchor(terra, addressProvider);
const aUstRate = 1.026242013201564664;
const toDecimal = 1000000;
const priceURL = "https://free.currconv.com/api/v7/convert?q=USD_CLP&compact=ultra&apiKey=54748356a9c80e24a8c0";

// Config

app.use(cors());
app.use(express.json());
app.listen(process.env.PORT || 3000);
app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  next();
});

// Routes & Middlewares

app.get('/user_data/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const existingUser = await findUser(username);
    if (!existingUser) {
      res.json({ error: "user not found" });
      return;
    }
    let response;
    if (existingUser.deposited) {
      // Fetch balance from anchor
      let balance = await getAnchorBalance(existingUser);
      const usdClpRequest = await axios.get(priceURL);
      const usdClp = parseFloat(usdClpRequest.data.USD_CLP);
      balance = Math.floor(balance * usdClp);
      response = {
        deposited: existingUser.deposited,
        balance,
        earnings: getMonthlyEarnings(balance)
      };
    } else {
      response = {
        deposited: 0,
        balance: 0,
        earnings: null
      };
    }
    res.json({
      data: response
    });

  } catch (error) {
    console.log(error);
    res.json({
      error: "internal error"
    });
  }
});

app.post('/create_user', async (req, res) => {
  const { username } = req.body;
  try {
    const existingUser = await findUser(username);
    if (existingUser) {
      res.json({
        error: "user already exists"
      });  
      return;
    }
    let owner = new MnemonicKey();
    await user.create({
      username,
      wallet: owner.accAddress,
      seed: owner.mnemonic,
      deposited: 0
    }, {
      fields: ["username", "wallet", "seed", "deposited"]
    });
    res.json({
      message: `created user '${username}'`
    });
  } catch (error) {
    console.log(error);
    res.json({
      error: "internal error"
    });  
  }
});

app.post('/deposit', async (req, res) => {
  const { username, amount } = req.body;
  const existingUser = await findUser(username);

  if (!existingUser) {
    res.json({
      error: "user not found"
    });
    return;
  }
  // Get current exchange rate for USD to CLP
  let response = await axios.get(priceURL);

  // Get user wallet
  let userKey = new MnemonicKey({
    mnemonic: existingUser.seed
  })
  const userWallet = new Wallet(terra, userKey);
  
  // Get main user wallet
  const mainUser = await findUser("main");
  const mainKey = new MnemonicKey({
    mnemonic: mainUser.seed
  });
  const mainWallet = new Wallet(terra, mainKey);

  let usdAmount = amount / parseFloat(response.data.USD_CLP);
  usdAmount = Math.ceil(usdAmount)
  let fees = 1
  let transferAmount = Math.ceil(usdAmount + fees);

  // Send UST to user wallet
  await send(mainUser, existingUser, mainWallet, transferAmount);

  const gasParameters = {
    gasAdjustment: 1.4,
    gasPrices: "0.15uusd",
  }
  const depositResult = await deposit(usdAmount, userWallet, gasParameters);
  console.log(depositResult)

  existingUser.deposited += amount
  await existingUser.save()

  res.json({
    message: "deposit successful"
  });})


app.post('/withdraw', async (req, res) => {
  const { username, amount } = req.body;
  try {
    const existingUser = await findUser(username);

    if (!existingUser) {
      res.json({
        error: "user not found"
      });
      return;
    }
    if (!existingUser.deposited) {
      res.json({
        error: "user has not deposited yet"
      });
      return;
    }
    // Convert CLP amount to USD
    let priceResponse = await axios.get(priceURL);
    let usdAmount = amount / parseFloat(priceResponse.data.USD_CLP);
    // Compute withdraw amount
    const withdrawAmount = usdAmount / aUstRate;
    console.log("withdraw amount: " + withdrawAmount);
    // Fetch balance from anchor
    const anchorBalance = await getAnchorBalance(existingUser);
    console.log("anchor balance: " + anchorBalance);
    // See if withdraw is possible
    if (anchorBalance < withdrawAmount) {
      res.json({
        error: "not enough funds for withdraw"
      });
      return;
    } 
    // Execute withdraw
    const userKey = new MnemonicKey({
      mnemonic: existingUser.seed
    });
    const wallet = new Wallet(terra, userKey);
    const gasParameters = {
      gasAdjustment: 1.6,
      gasPrices: "0.15uusd",
    }
    const withdrawResult = await withdraw(withdrawAmount, wallet, gasParameters);
    console.log(withdrawResult);

    // Send withdrawn UST to main wallet
    const mainUser = await findUser("main");
    const transferAmount = Math.floor(usdAmount);
    await send(existingUser, mainUser, wallet, transferAmount);

    // Deposit from main wallet into anchor
    const mainKey = new MnemonicKey({
      mnemonic: mainUser.seed
    });
    const mainWallet = new Wallet(terra, mainKey);    
    gasParameters.gasAdjustment = 2;
    const depositResult = await deposit(withdrawAmount, mainWallet, gasParameters);
    console.log(depositResult);

    // Check if 'desposited' attribute of user needs to be updated
    const balanceDifference = anchorBalance - usdAmount;
    console.log("balance difference: " + balanceDifference);
    let clpDifference = balanceDifference * parseFloat(priceResponse.data.USD_CLP);
    if (clpDifference < existingUser.deposited) {
      if (clpDifference < 0) clpDifference = 0;
      existingUser.deposited = clpDifference;
      await existingUser.save();
    }
    res.json({
      message: "funds withdrawn"
    });
  } catch (error) {
    console.log(error);
    res.json({
      error: "internal error"
    });
  }
});


// Util functions
async function findUser(username) {
  const dbUser = await user.findOne({
    where: {
      username
    }
  });

  return dbUser;
}

async function getAnchorBalance(existingUser) {
  const payload = {
    market: MARKET_DENOMS.UUSD,
    address: existingUser.wallet
  };
  const balance = await anchor.earn.getTotalDeposit(payload);

  return balance;
}

async function deposit(amount, wallet, gasParameters) {
  const payload = {
    market: MARKET_DENOMS.UUSD,
    amount: amount.toString()
  };
  const depositResult = await anchor.earn.depositStable(payload).execute(wallet, 
    gasParameters);

  return depositResult;
}

async function withdraw(amount, wallet, gasParameters) {
  const payload = {
    market: MARKET_DENOMS.UUSD,
    amount: amount.toString()
  };
  const withdrawResult =  await anchor.earn.withdrawStable(payload).execute(wallet,
    gasParameters);

  return withdrawResult;
}

async function send(fromUser, toUser, fromWallet, transferAmount) {
  const send = new MsgSend(
    fromUser.wallet,
    toUser.wallet,
    { uusd: transferAmount * toDecimal, uluna: 1 * toDecimal }
  );

  await fromWallet
  .createAndSignTx({
    msgs: [send],
    memo: 'test from haven!',
  })
  .then(tx => terra.tx.broadcast(tx))
  .then(result => {
    console.log(`TX hash: ${result.txhash}`);
  })
  .catch(err => console.log(err))
}

function getMonthlyEarnings(balance) {
  const annualRate = 18.7;
  const monthlyRate = annualRate / 12 / 100;
  const years = 1;
  const months = years * 12;
  let futureValue = balance;
  const earnings = [];
  for ( i = 1; i <= months; i++ ) {
    futureValue = (futureValue) * (1 + monthlyRate);
    earnings.push(futureValue);
  }

  return earnings;
}