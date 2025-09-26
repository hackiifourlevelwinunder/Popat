import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const RANDOM_ORG_API_KEY = process.env.RANDOM_ORG_API_KEY;

async function getCSRNG() {
  try {
    const res = await fetch("https://csrng.net/csrng/csrng.php?min=0&max=9");
    const data = await res.json();
    return data[0].random;
  } catch {
    return Math.floor(Math.random() * 10);
  }
}

async function getRandomOrg() {
  try {
    const res = await fetch("https://api.random.org/json-rpc/4/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "generateIntegers",
        params: {
          apiKey: RANDOM_ORG_API_KEY,
          n: 1,
          min: 0,
          max: 9,
          replacement: true,
        },
        id: 1,
      }),
    });
    const data = await res.json();
    return data.result.random.data[0];
  } catch {
    return Math.floor(Math.random() * 10);
  }
}

async function getNistBeacon() {
  try {
    const res = await fetch("https://beacon.nist.gov/beacon/2.0/pulse/last");
    const data = await res.json();
    const hex = data.pulse.outputValue.slice(-2); // last 2 hex digits
    return parseInt(hex, 16) % 10;
  } catch {
    return Math.floor(Math.random() * 10);
  }
}

function decideResult(nums) {
  let freq = {};
  nums.forEach(n => {
    freq[n] = (freq[n] || 0) + 1;
  });

  // Highest frequency
  let maxFreq = Math.max(...Object.values(freq));
  let candidates = Object.keys(freq).filter(n => freq[n] === maxFreq);

  if (candidates.length === 1) {
    return parseInt(candidates[0]); // clear winner
  } else {
    // tie breaker → Big/Small rule
    let big = 0, small = 0;
    candidates.forEach(n => {
      if (n >= 5) big++;
      else small++;
    });
    return big > small ? "Big" : "Small";
  }
}

app.get("/result", async (req, res) => {
  const c = await getCSRNG();
  const r = await getRandomOrg();
  const n = await getNistBeacon();

  const final = decideResult([c, r, n]);
  res.json({ numbers: [c, r, n], result: final });
});

app.listen(3000, () => console.log("✅ Server running on port 3000"));
