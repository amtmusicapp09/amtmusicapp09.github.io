const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================
   AMT CONFIG
========================================= */

const AMT_CONFIG = {
    project: "AMT Music",
    version: "1.1.0",
    network: "AMT Testnet / Sandbox",

    mining: {
        rate: 0.25,
        cycleHours: 24,
        dailyLimit: 6
    },

    referralTiers: [
        { name: "Pioneer",  minReferrals: 0,   bonus: 0.00 },
        { name: "Bronze",   minReferrals: 5,   bonus: 0.05 },
        { name: "Silver",   minReferrals: 10,  bonus: 0.10 },
        { name: "Gold",     minReferrals: 25,  bonus: 0.15 },
        { name: "Platinum", minReferrals: 50,  bonus: 0.20 },
        { name: "Diamond",  minReferrals: 100, bonus: 0.25 }
    ]
};

/* =========================================
   TEMPORARY MEMORY STORE

   NOTE:
   This is for testnet/sandbox development.
   Production will require a persistent DB.
========================================= */

const users = new Map();

const demoUser = {
    id: "demo-pioneer",
    username: "Pioneer",
    isPioneer: true,

    balance: 0,

    mining: {
        active: false,
        startedAt: null,
        lastClaimAt: null,
        todayReward: 0,
        cycleReward: 0
    },

    referrals: 0,

    createdAt: new Date().toISOString()
};

users.set(demoUser.id, demoUser);

/* =========================================
   HELPERS
========================================= */

function getUser() {
    return users.get("demo-pioneer");
}

function getReferralTier(referrals) {

    let current = AMT_CONFIG.referralTiers[0];

    for (const tier of AMT_CONFIG.referralTiers) {
        if (referrals >= tier.minReferrals) {
            current = tier;
        }
    }

    return current;
}

function sendJson(res, status, data) {
    res.status(status);
    res.type("application/json");
    res.json(data);
}

/* =========================================
   HEALTH / STATUS
========================================= */

app.get("/api/status", (req, res) => {

    sendJson(res, 200, {
        success: true,
        service: AMT_CONFIG.project,
        status: "online",
        version: AMT_CONFIG.version,
        network: AMT_CONFIG.network,

        miningRate: AMT_CONFIG.mining.rate,
        miningCycle: `${AMT_CONFIG.mining.cycleHours} hours`,
        dailyLimit: AMT_CONFIG.mining.dailyLimit,

        timestamp: new Date().toISOString()
    });

});

/* Health alias */
app.get("/api/health", (req, res) => {

    sendJson(res, 200, {
        success: true,
        status: "online",
        service: AMT_CONFIG.project,
        version: AMT_CONFIG.version,
        network: AMT_CONFIG.network,
        timestamp: new Date().toISOString()
    });

});

/* =========================================
   USER
========================================= */

app.get("/api/user", (req, res) => {

    const user = getUser();

    sendJson(res, 200, {
        success: true,

        user: {
            id: user.id,
            username: user.username,
            isPioneer: user.isPioneer
        }
    });

});

/* =========================================
   WALLET
========================================= */

app.get("/api/wallet", (req, res) => {

    const user = getUser();

    sendJson(res, 200, {
        success: true,

        wallet: {
            asset: "AMT",
            balance: Number(user.balance).toFixed(4)
        }
    });

});

/* =========================================
   REFERRAL
========================================= */

app.get("/api/referral", (req, res) => {

    const user = getUser();
    const tier = getReferralTier(user.referrals);

    sendJson(res, 200, {
        success: true,

        referrals: user.referrals,

        tier: tier.name,

        bonus: `${tier.bonus * 100}%`,

        nextTier: getNextTier(user.referrals)
    });

});

function getNextTier(referrals) {

    for (const tier of AMT_CONFIG.referralTiers) {

        if (referrals < tier.minReferrals) {

            return {
                name: tier.name,
                requiredReferrals: tier.minReferrals
            };

        }
    }

    return null;
}

/* =========================================
   MINING STATUS
========================================= */

app.get("/api/mining/status", (req, res) => {

    const user = getUser();

    sendJson(res, 200, {

        success: true,

        mining: {

            active: user.mining.active,

            rate: AMT_CONFIG.mining.rate,

            cycleHours:
                AMT_CONFIG.mining.cycleHours,

            dailyLimit:
                AMT_CONFIG.mining.dailyLimit,

            todayReward:
                Number(
                    user.mining.todayReward
                ).toFixed(4),

            cycleReward:
                Number(
                    user.mining.cycleReward
                ).toFixed(4),

            lastClaimAt:
                user.mining.lastClaimAt,

            startedAt:
                user.mining.startedAt
        }

    });

});

/* =========================================
   START MINING
========================================= */

function startMining(req, res) {

    const user = getUser();

    if (!user.isPioneer) {

        return sendJson(res, 403, {
            success: false,
            error:
                "Only verified Pioneer accounts can access AMT mining."
        });

    }

    if (user.mining.active) {

        return sendJson(res, 400, {
            success: false,
            error: "Mining is already active.",
            mining: {
                active: true
            }
        });

    }

    const now = new Date().toISOString();

    user.mining.active = true;
    user.mining.startedAt = now;

    sendJson(res, 200, {

        success: true,

        message: "AMT mining started.",

        mining: {

            active: true,

            startedAt: now,

            rate:
                AMT_CONFIG.mining.rate,

            cycleHours:
                AMT_CONFIG.mining.cycleHours,

            dailyLimit:
                AMT_CONFIG.mining.dailyLimit
        }

    });

}

/*
   Multiple compatible endpoints.
   This prevents frontend/API path mismatch.
*/

app.post("/api/mining/start", startMining);

app.get("/api/mining/start", startMining);

app.post("/api/mine/start", startMining);

app.post("/api/start-mining", startMining);

/* =========================================
   STOP MINING
========================================= */

function stopMining(req, res) {

    const user = getUser();

    user.mining.active = false;

    sendJson(res, 200, {

        success: true,

        message: "AMT mining paused.",

        mining: {
            active: false
        }

    });

}

app.post("/api/mining/stop", stopMining);

app.get("/api/mining/stop", stopMining);

app.post("/api/mine/stop", stopMining);

app.post("/api/stop-mining", stopMining);

/* =========================================
   MINING CLAIM
========================================= */

app.post("/api/mining/claim", (req, res) => {

    const user = getUser();

    if (!user.isPioneer) {

        return sendJson(res, 403, {
            success: false,
            error: "Pioneer verification required."
        });

    }

    if (!user.mining.active) {

        return sendJson(res, 400, {
            success: false,
            error: "Mining is not active."
        });

    }

    const reward = AMT_CONFIG.mining.rate;

    user.balance += reward;

    user.mining.todayReward += reward;
    user.mining.cycleReward += reward;
    user.mining.lastClaimAt =
        new Date().toISOString();

    sendJson(res, 200, {

        success: true,

        message: "AMT mining reward recorded.",

        reward: reward,

        wallet: {
            asset: "AMT",
            balance:
                Number(user.balance).toFixed(4)
        },

        mining: {
            todayReward:
                Number(
                    user.mining.todayReward
                ).toFixed(4)
        }

    });

});

/* =========================================
   MARKETPLACE
========================================= */

app.get("/api/marketplace", (req, res) => {

    sendJson(res, 200, {

        success: true,

        currency: "AMT",

        items: [

            {
                id: "music-premium",
                name: "Premium Music",
                price: 100
            },

            {
                id: "artist-promotion",
                name: "Artist Promotion",
                price: 250
            },

            {
                id: "digital-content",
                name: "Digital Content",
                price: 150
            },

            {
                id: "event-access",
                name: "Event Access",
                price: 300
            }

        ]

    });

});

/* =========================================
   PI INTEGRATION STATUS
========================================= */

app.get("/api/pi/status", (req, res) => {

    sendJson(res, 200, {

        success: true,

        integration: "Pi Network",

        status: "READY_FOR_OFFICIAL_SDK",

        network:
            AMT_CONFIG.network,

        message:
            "Official Pi SDK integration will be connected after Pi Developer approval/configuration."

    });

});

/* =========================================
   ROOT
========================================= */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});

/* =========================================
   API 404

   IMPORTANT:
   API errors MUST return JSON,
   never an HTML page.
========================================= */

app.use("/api", (req, res) => {

    sendJson(res, 404, {

        success: false,

        error: "API endpoint not found.",

        path: req.originalUrl

    });

});

/* =========================================
   SERVER ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {

    console.error(err);

    if (req.originalUrl.startsWith("/api")) {

        return sendJson(res, 500, {

            success: false,

            error: "AMT server error."

        });

    }

    res.status(500).send(
        "AMT Music Server Error"
    );

});

/* =========================================
   SERVER
========================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `AMT Music server running on port ${PORT}`
        );

        console.log(
            `Network: ${AMT_CONFIG.network}`
        );

    }
);