"use strict";

/*
 * ============================================================
 * AMT MUSIC MINING TOKEN
 * Backend v2.0.0
 *
 * Network: AMT Testnet / Sandbox
 * Maximum Supply: 40,000,000 AMT
 *
 * Features:
 * - PostgreSQL database
 * - Pi account authentication
 * - Mining
 * - 40M hard supply cap
 * - Daily check-in
 * - Pioneer reputation
 * - Unlimited referrals
 * - Referral tiers
 * - Marketplace
 *
 * IMPORTANT:
 * - Never ask for or store a Pi wallet passphrase.
 * - Testnet/Sandbox only.
 * ============================================================
 */

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
 * ------------------------------------------------------------
 * CONFIG
 * ------------------------------------------------------------
 */

const AMT_CONFIG = {
    project: "AMT Music Mining Token",
    version: "2.0.0",
    network: process.env.AMT_NETWORK || "AMT Testnet / Sandbox",

    token: {
        symbol: "AMT",
        maximumSupply: 40000000
    },

    mining: {
        ratePerHour: 0.25,
        dailyMiningLimit: 6
    },

    rewards: {
        dailyCheckIn: 10
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

/*
 * ------------------------------------------------------------
 * DATABASE
 * ------------------------------------------------------------
 */

if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not configured.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

/*
 * ------------------------------------------------------------
 * DATABASE INITIALIZATION
 * ------------------------------------------------------------
 */

async function initializeDatabase() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is missing.");
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS amt_users (
            id SERIAL PRIMARY KEY,
            pi_uid TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            balance NUMERIC(30,8) NOT NULL DEFAULT 0,
            mining_active BOOLEAN NOT NULL DEFAULT FALSE,
            mining_started_at TIMESTAMPTZ,
            last_mining_claim_at TIMESTAMPTZ,
            today_mining_reward NUMERIC(30,8) NOT NULL DEFAULT 0,
            today_mining_date DATE,
            referrals INTEGER NOT NULL DEFAULT 0,
            reputation INTEGER NOT NULL DEFAULT 0,
            referred_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS amt_transactions (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            type TEXT NOT NULL,
            amount NUMERIC(30,8) NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS amt_referrals (
            id SERIAL PRIMARY KEY,
            referrer_username TEXT NOT NULL,
            referred_username TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS amt_supply (
            id INTEGER PRIMARY KEY,
            issued NUMERIC(30,8) NOT NULL DEFAULT 0,
            maximum NUMERIC(30,8) NOT NULL
        );
    `);

    await pool.query(`
        INSERT INTO amt_supply (id, issued, maximum)
        VALUES (1, 0, $1)
        ON CONFLICT (id) DO NOTHING;
    `, [AMT_CONFIG.token.maximumSupply]);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS amt_sessions (
            id SERIAL PRIMARY KEY,
            session_token TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            pi_uid TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    console.log("AMT PostgreSQL database initialized.");
}

/*
 * ------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------
 */

function sendJson(res, status, data) {
    return res.status(status).json(data);
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

function getTodayUTC() {
    return new Date().toISOString().slice(0, 10);
}

/*
 * ------------------------------------------------------------
 * CORS
 * ------------------------------------------------------------
 */

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
        res.header("Access-Control-Allow-Credentials", "true");
    }

    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

/*
 * ------------------------------------------------------------
 * SESSION HELPERS
 * ------------------------------------------------------------
 */

function getBearerToken(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    return header.slice(7).trim();
}

async function getSessionUser(req) {
    const token = getBearerToken(req);

    if (!token) {
        return null;
    }

    const result = await pool.query(`
        SELECT
            s.username,
            s.pi_uid,
            u.id,
            u.balance,
            u.mining_active,
            u.mining_started_at,
            u.last_mining_claim_at,
            u.today_mining_reward,
            u.today_mining_date,
            u.referrals,
            u.reputation,
            u.referred_by
        FROM amt_sessions s
        JOIN amt_users u
            ON u.username = s.username
        WHERE s.session_token = $1
          AND s.expires_at > NOW()
        LIMIT 1
    `, [token]);

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
}

async function requireUser(req, res, next) {
    try {
        const user = await getSessionUser(req);

        if (!user) {
            return sendJson(res, 401, {
                success: false,
                error: "AMT Pioneer login required."
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Authentication service error."
        });
    }
}

/*
 * ------------------------------------------------------------
 * BASIC STATUS
 * ------------------------------------------------------------
 */

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        return sendJson(res, 200, {
            success: true,
            status: "online",
            database: "online",
            service: AMT_CONFIG.project,
            version: AMT_CONFIG.version,
            network: AMT_CONFIG.network,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 503, {
            success: false,
            status: "online",
            database: "offline",
            service: AMT_CONFIG.project,
            version: AMT_CONFIG.version,
            network: AMT_CONFIG.network
        });
    }
});

app.get("/api/status", async (req, res) => {
    try {
        const supply = await pool.query(`
            SELECT issued, maximum
            FROM amt_supply
            WHERE id = 1
        `);

        const row = supply.rows[0];

        return sendJson(res, 200, {
            success: true,
            service: AMT_CONFIG.project,
            status: "online",
            version: AMT_CONFIG.version,
            network: AMT_CONFIG.network,

            token: {
                symbol: AMT_CONFIG.token.symbol,
                maximumSupply: Number(row.maximum),
                issued: Number(row.issued),
                remaining: Number(row.maximum) - Number(row.issued)
            },

            mining: {
                ratePerHour: AMT_CONFIG.mining.ratePerHour,
                dailyMiningLimit: AMT_CONFIG.mining.dailyMiningLimit
            },

            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Unable to read AMT status."
        });
    }
});

/*
 * ------------------------------------------------------------
 * PI AUTHENTICATION
 * ------------------------------------------------------------
 *
 * Frontend sends the Pi SDK accessToken.
 * Backend verifies it with the official Pi API.
 */

app.post("/api/auth/pi", async (req, res) => {
    try {
        const { accessToken } = req.body;

        if (!accessToken) {
            return sendJson(res, 400, {
                success: false,
                error: "Pi access token is required."
            });
        }

        const response = await fetch(
            "https://api.minepi.com/v2/me",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        if (!response.ok) {
            return sendJson(res, 401, {
                success: false,
                error: "Pi account verification failed."
            });
        }

        const piUser = await response.json();

        if (!piUser.uid || !piUser.username) {
            return sendJson(res, 401, {
                success: false,
                error: "Invalid Pi account information."
            });
        }

        const existing = await pool.query(`
            SELECT *
            FROM amt_users
            WHERE pi_uid = $1
            LIMIT 1
        `, [piUser.uid]);

        let user;

        if (existing.rows.length === 0) {
            const created = await pool.query(`
                INSERT INTO amt_users (
                    pi_uid,
                    username
                )
                VALUES ($1, $2)
                RETURNING *
            `, [
                piUser.uid,
                piUser.username
            ]);

            user = created.rows[0];
        } else {
            user = existing.rows[0];
        }

        /*
         * Session valid for 7 days.
         * Token is random and stored only as a session identifier.
         */
        const sessionToken = crypto
            .randomBytes(32)
            .toString("hex");

        await pool.query(`
            INSERT INTO amt_sessions (
                session_token,
                username,
                pi_uid,
                expires_at
            )
            VALUES (
                $1,
                $2,
                $3,
                NOW() + INTERVAL '7 days'
            )
        `, [
            sessionToken,
            user.username,
            user.pi_uid
        ]);

        return sendJson(res, 200, {
            success: true,
            message: "Pi Pioneer authenticated successfully.",

            sessionToken,

            user: {
                id: user.id,
                piUid: user.pi_uid,
                username: user.username,
                balance: Number(user.balance),
                referrals: user.referrals,
                reputation: user.reputation
            },

            network: AMT_CONFIG.network
        });

    } catch (error) {
        console.error("Pi authentication error:", error);

        return sendJson(res, 500, {
            success: false,
            error: "Pi authentication service error."
        });
    }
});

/*
 * ------------------------------------------------------------
 * LOGOUT
 * ------------------------------------------------------------
 */

app.post("/api/auth/logout", requireUser, async (req, res) => {
    try {
        const token = getBearerToken(req);

        await pool.query(`
            DELETE FROM amt_sessions
            WHERE session_token = $1
        `, [token]);

        return sendJson(res, 200, {
            success: true,
            message: "Pioneer logged out."
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Logout failed."
        });
    }
});

/*
 * ------------------------------------------------------------
 * USER
 * ------------------------------------------------------------
 */

app.get("/api/user", requireUser, async (req, res) => {
    return sendJson(res, 200, {
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            piUid: req.user.pi_uid,
            isPioneer: true,
            balance: Number(req.user.balance),
            referrals: req.user.referrals,
            reputation: req.user.reputation,
            referredBy: req.user.referred_by
        }
    });
});

/*
 * ------------------------------------------------------------
 * WALLET
 * ------------------------------------------------------------
 */

app.get("/api/wallet", requireUser, async (req, res) => {
    return sendJson(res, 200, {
        success: true,
        wallet: {
            asset: "AMT",
            balance: Number(req.user.balance).toFixed(4)
        }
    });
});

/*
 * ------------------------------------------------------------
 * SUPPLY
 * ------------------------------------------------------------
 */

app.get("/api/supply", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT issued, maximum
            FROM amt_supply
            WHERE id = 1
        `);

        const supply = result.rows[0];

        return sendJson(res, 200, {
            success: true,
            asset: "AMT",
            maximumSupply: Number(supply.maximum),
            issued: Number(supply.issued),
            remaining: Number(supply.maximum) - Number(supply.issued)
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Supply information unavailable."
        });
    }
});

/*
 * ------------------------------------------------------------
 * MINING STATUS
 * ------------------------------------------------------------
 */

app.get("/api/mining/status", requireUser, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                mining_active,
                mining_started_at,
                last_mining_claim_at,
                today_mining_reward,
                today_mining_date
            FROM amt_users
            WHERE id = $1
        `, [req.user.id]);

        const mining = result.rows[0];

        let todayReward = Number(mining.today_mining_reward);

        if (
            !mining.today_mining_date ||
            mining.today_mining_date.toISOString().slice(0, 10) !== getTodayUTC()
        ) {
            todayReward = 0;
        }

        return sendJson(res, 200, {
            success: true,
            mining: {
                active: mining.mining_active,
                ratePerHour: AMT_CONFIG.mining.ratePerHour,
                dailyLimit: AMT_CONFIG.mining.dailyMiningLimit,
                todayReward: todayReward.toFixed(4),
                lastClaimAt: mining.last_mining_claim_at,
                startedAt: mining.mining_started_at
            }
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Mining status unavailable."
        });
    }
});

/*
 * ------------------------------------------------------------
 * START MINING
 * ------------------------------------------------------------
 */

app.post("/api/mining/start", requireUser, async (req, res) => {
    try {
        if (req.user.mining_active) {
            return sendJson(res, 400, {
                success: false,
                error: "Mining is already active."
            });
        }

        const now = new Date();

        await pool.query(`
            UPDATE amt_users
            SET
                mining_active = TRUE,
                mining_started_at = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [now, req.user.id]);

        return sendJson(res, 200, {
            success: true,
            message: "AMT mining started.",
            mining: {
                active: true,
                startedAt: now.toISOString(),
                ratePerHour: AMT_CONFIG.mining.ratePerHour,
                dailyLimit: AMT_CONFIG.mining.dailyMiningLimit
            }
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Unable to start mining."
        });
    }
});

/*
 * ------------------------------------------------------------
 * STOP MINING
 * ------------------------------------------------------------
 */

app.post("/api/mining/stop", requireUser, async (req, res) => {
    try {
        await pool.query(`
            UPDATE amt_users
            SET
                mining_active = FALSE,
                updated_at = NOW()
            WHERE id = $1
        `, [req.user.id]);

        return sendJson(res, 200, {
            success: true,
            message: "AMT mining paused.",
            mining: {
                active: false
            }
        });
    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Unable to stop mining."
        });
    }
});

/*
 * ------------------------------------------------------------
 * MINING CLAIM
 * ------------------------------------------------------------
 *
 * Daily mining limit = 6 AMT per UTC day.
 */

app.post("/api/mining/claim", requireUser, async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(`
            SELECT *
            FROM amt_users
            WHERE id = $1
            FOR UPDATE
        `, [req.user.id]);

        if (userResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return sendJson(res, 404, {
                success: false,
                error: "Pioneer account not found."
            });
        }

        const user = userResult.rows[0];

        if (!user.mining_active) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "Mining is not active."
            });
        }

        const today = getTodayUTC();

        let todayReward = Number(user.today_mining_reward);

        if (
            !user.today_mining_date ||
            user.today_mining_date.toISOString().slice(0, 10) !== today
        ) {
            todayReward = 0;
        }

        const reward = AMT_CONFIG.mining.ratePerHour;

        if (
            todayReward + reward >
            AMT_CONFIG.mining.dailyMiningLimit
        ) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "Daily mining limit reached.",
                todayReward: todayReward.toFixed(4),
                dailyLimit: AMT_CONFIG.mining.dailyMiningLimit
            });
        }

        /*
         * Lock supply row.
         * This makes the 40M maximum supply atomic.
         */
        const supplyResult = await client.query(`
            SELECT issued, maximum
            FROM amt_supply
            WHERE id = 1
            FOR UPDATE
        `);

        const supply = supplyResult.rows[0];

        const issued = Number(supply.issued);
        const maximum = Number(supply.maximum);

        if (issued + reward > maximum) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "AMT maximum supply has been reached."
            });
        }

        const newBalance =
            Number(user.balance) + reward;

        const newTodayReward =
            todayReward + reward;

        await client.query(`
            UPDATE amt_supply
            SET issued = issued + $1
            WHERE id = 1
        `, [reward]);

        await client.query(`
            UPDATE amt_users
            SET
                balance = $1,
                today_mining_reward = $2,
                today_mining_date = $3,
                last_mining_claim_at = NOW(),
                updated_at = NOW()
            WHERE id = $4
        `, [
            newBalance,
            newTodayReward,
            today,
            user.id
        ]);

        await client.query(`
            INSERT INTO amt_transactions (
                username,
                type,
                amount,
                description
            )
            VALUES ($1, $2, $3, $4)
        `, [
            user.username,
            "MINING",
            reward,
            "AMT Testnet mining reward"
        ]);

        await client.query("COMMIT");

        return sendJson(res, 200, {
            success: true,
            message: "AMT mining reward recorded.",

            reward,

            wallet: {
                asset: "AMT",
                balance: newBalance.toFixed(4)
            },

            mining: {
                todayReward: newTodayReward.toFixed(4),
                dailyLimit: AMT_CONFIG.mining.dailyMiningLimit
            }
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Mining claim error:", error);

        return sendJson(res, 500, {
            success: false,
            error: "Mining claim failed."
        });
    } finally {
        client.release();
    }
});

/*
 * ------------------------------------------------------------
 * DAILY CHECK-IN
 * ------------------------------------------------------------
 *
 * TESTNET DEMO ONLY.
 * Mainnet reward distribution will be handled separately.
 */

app.post("/api/rewards/daily-checkin", requireUser, async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(`
            SELECT *
            FROM amt_users
            WHERE id = $1
            FOR UPDATE
        `, [req.user.id]);

        const user = userResult.rows[0];

        const today = getTodayUTC();

        const existing = await client.query(`
            SELECT id
            FROM amt_transactions
            WHERE username = $1
              AND type = 'DAILY_CHECKIN'
              AND DATE(created_at AT TIME ZONE 'UTC') = $2
            LIMIT 1
        `, [user.username, today]);

        if (existing.rows.length > 0) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "Daily check-in already claimed today."
            });
        }

        const reward =
            AMT_CONFIG.rewards.dailyCheckIn;

        const supplyResult = await client.query(`
            SELECT issued, maximum
            FROM amt_supply
            WHERE id = 1
            FOR UPDATE
        `);

        const supply = supplyResult.rows[0];

        if (
            Number(supply.issued) + reward >
            Number(supply.maximum)
        ) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "AMT maximum supply has been reached."
            });
        }

        const newBalance =
            Number(user.balance) + reward;

        const newReputation =
            Number(user.reputation) + 1;

        await client.query(`
            UPDATE amt_supply
            SET issued = issued + $1
            WHERE id = 1
        `, [reward]);

        await client.query(`
            UPDATE amt_users
            SET
                balance = $1,
                reputation = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [
            newBalance,
            newReputation,
            user.id
        ]);

        await client.query(`
            INSERT INTO amt_transactions (
                username,
                type,
                amount,
                description
            )
            VALUES ($1, $2, $3, $4)
        `, [
            user.username,
            "DAILY_CHECKIN",
            reward,
            "AMT Testnet daily check-in"
        ]);

        await client.query("COMMIT");

        return sendJson(res, 200, {
            success: true,
            message: "Daily check-in reward recorded.",
            reward,
            reputation: newReputation,
            balance: newBalance.toFixed(4)
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Daily check-in failed."
        });
    } finally {
        client.release();
    }
});

/*
 * ------------------------------------------------------------
 * REFERRAL
 * ------------------------------------------------------------
 *
 * Referral code = Pioneer Pi username.
 * Unlimited referrals.
 */

app.get("/api/referral", requireUser, async (req, res) => {
    try {
        const tier = getReferralTier(
            req.user.referrals
        );

        return sendJson(res, 200, {
            success: true,

            referralCode: req.user.username,

            referrals: req.user.referrals,

            tier: tier.name,

            bonus: `${tier.bonus * 100}%`,

            nextTier: getNextTier(
                req.user.referrals
            )
        });

    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Referral information unavailable."
        });
    }
});

app.post("/api/referral/apply", requireUser, async (req, res) => {
    const client = await pool.connect();

    try {
        const referrerUsername =
            String(req.body.referrerUsername || "").trim();

        if (!referrerUsername) {
            return sendJson(res, 400, {
                success: false,
                error: "Referrer Pioneer username is required."
            });
        }

        if (
            referrerUsername.toLowerCase() ===
            req.user.username.toLowerCase()
        ) {
            return sendJson(res, 400, {
                success: false,
                error: "Self-referral is not allowed."
            });
        }

        await client.query("BEGIN");

        const currentUserResult = await client.query(`
            SELECT *
            FROM amt_users
            WHERE id = $1
            FOR UPDATE
        `, [req.user.id]);

        const currentUser = currentUserResult.rows[0];

        if (currentUser.referred_by) {
            await client.query("ROLLBACK");

            return sendJson(res, 400, {
                success: false,
                error: "Referral has already been assigned."
            });
        }

        const referrerResult = await client.query(`
            SELECT *
            FROM amt_users
            WHERE LOWER(username) = LOWER($1)
            FOR UPDATE
        `, [referrerUsername]);

        if (referrerResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return sendJson(res, 404, {
                success: false,
                error: "Referrer Pioneer not found."
            });
        }

        const referrer = referrerResult.rows[0];

        await client.query(`
            INSERT INTO amt_referrals (
                referrer_username,
                referred_username
            )
            VALUES ($1, $2)
        `, [
            referrer.username,
            currentUser.username
        ]);

        await client.query(`
            UPDATE amt_users
            SET
                referred_by = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [
            referrer.username,
            currentUser.id
        ]);

        await client.query(`
            UPDATE amt_users
            SET
                referrals = referrals + 1,
                reputation = reputation + 1,
                updated_at = NOW()
            WHERE id = $1
        `, [referrer.id]);

        await client.query("COMMIT");

        return sendJson(res, 200, {
            success: true,
            message: "Referral successfully recorded.",
            referrer: referrer.username
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Referral processing failed."
        });
    } finally {
        client.release();
    }
});

/*
 * ------------------------------------------------------------
 * REPUTATION
 * ------------------------------------------------------------
 */

app.get("/api/reputation", requireUser, async (req, res) => {
    const tier = getReferralTier(req.user.referrals);

    return sendJson(res, 200, {
        success: true,
        username: req.user.username,
        reputation: req.user.reputation,
        referrals: req.user.referrals,
        referralTier: tier.name
    });
});

/*
 * ------------------------------------------------------------
 * TRANSACTIONS
 * ------------------------------------------------------------
 */

app.get("/api/transactions", requireUser, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                type,
                amount,
                description,
                created_at
            FROM amt_transactions
            WHERE username = $1
            ORDER BY created_at DESC
            LIMIT 100
        `, [req.user.username]);

        return sendJson(res, 200, {
            success: true,
            transactions: result.rows.map(row => ({
                id: row.id,
                type: row.type,
                amount: Number(row.amount),
                description: row.description,
                createdAt: row.created_at
            }))
        });

    } catch (error) {
        console.error(error);

        return sendJson(res, 500, {
            success: false,
            error: "Transaction history unavailable."
        });
    }
});

/*
 * ------------------------------------------------------------
 * MARKETPLACE
 * ------------------------------------------------------------
 */

app.get("/api/marketplace", async (req, res) => {
    return sendJson(res, 200, {
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

/*
 * ------------------------------------------------------------
 * PI STATUS
 * ------------------------------------------------------------
 */

app.get("/api/pi/status", async (req, res) => {
    return sendJson(res, 200, {
        success: true,
        integration: "Pi Network",
        status: "READY_FOR_OFFICIAL_SDK",
        network: AMT_CONFIG.network,

        message:
            "Pi account authentication is prepared for official Pi SDK integration."
    });
});

/*
 * ------------------------------------------------------------
 * ROOT
 * ------------------------------------------------------------
 */

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "index.html")
    );
});

/*
 * ------------------------------------------------------------
 * API 404
 * ------------------------------------------------------------
 */

app.use("/api", (req, res) => {
    return sendJson(res, 404, {
        success: false,
        error: "API endpoint not found.",
        path: req.originalUrl
    });
});

/*
 * ------------------------------------------------------------
 * ERROR HANDLER
 * ------------------------------------------------------------
 */

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

/*
 * ------------------------------------------------------------
 * START SERVER
 * ------------------------------------------------------------
 */

async function startServer() {
    try {
        await initializeDatabase();

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

                console.log(
                    `Maximum Supply: ${AMT_CONFIG.token.maximumSupply} AMT`
                );

                console.log(
                    `Mining Rate: ${AMT_CONFIG.mining.ratePerHour} AMT/H`
                );
            }
        );

    } catch (error) {
        console.error(
            "AMT server failed to start:",
            error
        );

        process.exit(1);
    }
}

startServer();