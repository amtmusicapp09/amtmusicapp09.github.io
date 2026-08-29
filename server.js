const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

/* =========================================
MIDDLEWARE
========================================= */

app.use(express.json());

app.use(express.urlencoded({
extended: true
}));

/* =========================================
STATIC FRONTEND
========================================= */

app.use(express.static(__dirname));

/* =========================================
AMT CONFIGURATION
========================================= */

const AMT_CONFIG = {
project: "AMT Music",
version: "1.0.0",
network: "AMT Testnet / Sandbox",

mining: {
    rate: 0.25,
    cycleHours: 24,
    dailyLimit: 6
},

referralTiers: [
    {
        name: "Pioneer",
        minReferrals: 0,
        bonus: 0
    },
    {
        name: "Bronze",
        minReferrals: 5,
        bonus: 0.05
    },
    {
        name: "Silver",
        minReferrals: 10,
        bonus: 0.10
    },
    {
        name: "Gold",
        minReferrals: 25,
        bonus: 0.15
    },
    {
        name: "Platinum",
        minReferrals: 50,
        bonus: 0.20
    },
    {
        name: "Diamond",
        minReferrals: 100,
        bonus: 0.25
    }
]

};

/* =========================================
TEMPORARY MVP MEMORY STORE

IMPORTANT:
This is NOT the final production ledger.

Render can restart the service, which means
this temporary data can be lost.

Persistent database will be added next.
========================================= */

const users = new Map();

/* =========================================
DEFAULT USER
========================================= */

const demoUser = {
id: "demo-pioneer",
username: "Pioneer",
isPioneer: true,

balance: 0,

mining: {
    active: false,
    startedAt: null,
    lastClaimAt: null,
    todayReward: 0
},

referrals: 0,

createdAt: new Date().toISOString()

};

users.set(
demoUser.id,
demoUser
);

/* =========================================
HELPER: REFERRAL TIER
========================================= */

function getReferralTier(referrals) {

let currentTier =
    AMT_CONFIG.referralTiers[0];

for (
    const tier
    of AMT_CONFIG.referralTiers
) {

    if (
        referrals >=
        tier.minReferrals
    ) {

        currentTier = tier;

    }

}

return currentTier;

}

/* =========================================
HEALTH / STATUS
========================================= */

app.get(
"/api/status",
(req, res) => {

    res.json({

        service:
            AMT_CONFIG.project,

        status:
            "online",

        version:
            AMT_CONFIG.version,

        network:
            AMT_CONFIG.network,

        miningRate:
            AMT_CONFIG.mining.rate,

        miningCycle:
            `${AMT_CONFIG.mining.cycleHours} hours`,

        dailyLimit:
            AMT_CONFIG.mining.dailyLimit,

        timestamp:
            new Date().toISOString()

    });

}

);

/* =========================================
USER PROFILE
========================================= */

app.get(
"/api/user",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    res.json({

        success: true,

        user: {
            id: user.id,
            username: user.username,
            isPioneer: user.isPioneer
        }

    });

}

);

/* =========================================
WALLET
========================================= */

app.get(
"/api/wallet",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    res.json({

        success: true,

        wallet: {
            asset: "AMT",
            balance:
                Number(
                    user.balance
                ).toFixed(4)
        }

    });

}

);

/* =========================================
REFERRAL
========================================= */

app.get(
"/api/referral",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    const tier =
        getReferralTier(
            user.referrals
        );

    res.json({

        success: true,

        referrals:
            user.referrals,

        tier: tier.name,

        bonus:
            `${tier.bonus * 100}%`

    });

}

);

/* =========================================
MINING STATUS
========================================= */

app.get(
"/api/mining/status",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    res.json({

        success: true,

        mining: {

            active:
                user.mining.active,

            rate:
                AMT_CONFIG.mining.rate,

            cycleHours:
                AMT_CONFIG.mining.cycleHours,

            dailyLimit:
                AMT_CONFIG.mining.dailyLimit,

            todayReward:
                Number(
                    user.mining.todayReward
                ).toFixed(4),

            lastClaimAt:
                user.mining.lastClaimAt

        }

    });

}

);

/* =========================================
START MINING
========================================= */

app.post(
"/api/mining/start",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    if (!user.isPioneer) {

        return res.status(403).json({

            success: false,

            error:
                "Only verified Pioneer accounts can access AMT mining."

        });

    }

    if (user.mining.active) {

        return res.status(400).json({

            success: false,

            error:
                "Mining is already active."

        });

    }

    user.mining.active = true;

    user.mining.startedAt =
        new Date().toISOString();

    res.json({

        success: true,

        message:
            "AMT mining started.",

        mining: {

            active: true,

            startedAt:
                user.mining.startedAt,

            rate:
                AMT_CONFIG.mining.rate,

            cycleHours:
                AMT_CONFIG.mining.cycleHours

        }

    });

}

);

/* =========================================
STOP MINING
========================================= */

app.post(
"/api/mining/stop",
(req, res) => {

    const user =
        users.get("demo-pioneer");

    user.mining.active = false;

    res.json({

        success: true,

        message:
            "AMT mining paused."

    });

}

);

/* =========================================
MARKETPLACE
========================================= */

app.get(
"/api/marketplace",
(req, res) => {

    res.json({

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

}

);

/* =========================================
ROOT
========================================= */

app.get(
"/",
(req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );

}

);

/* =========================================
404 API HANDLER
========================================= */

app.use(
"/api",
(req, res) => {

    res.status(404).json({

        success: false,

        error:
            "API endpoint not found."

    });

}

);

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

}

);