// basic imports needed to run the express server and fetch data
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

// sets up the express app and picks a port (defaults to 3000)
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
    next();
});

// makes everything inside /source folder publicly accessible
app.use(express.static('source'));

// dictionary of all the services we want to monitor, grouped by category
const services = {
    // AI Services
    openai: { name: 'OpenAI', url: 'https://status.openai.com/api/v2/summary.json', category: 'ai' },
    anthropic: { name: 'Anthropic', url: 'https://status.anthropic.com/api/v2/summary.json', category: 'ai' },
    deepseek: { name: 'DeepSeek', url: 'https://status.deepseek.com/api/v2/summary.json', category: 'ai' },

    // Messaging & Collaboration
    discord: { name: 'Discord', url: 'https://discordstatus.com/api/v2/summary.json', category: 'messaging' },
    zoom: { name: 'Zoom', url: 'https://status.zoom.us/api/v2/summary.json', category: 'messaging' },

    // Streaming & Media
    twitch: { name: 'Twitch', url: 'https://status.twitch.tv/api/v2/summary.json', category: 'streaming' },
    spotify: { name: 'Spotify', url: 'https://spotify.statuspage.io/api/v2/summary.json', category: 'streaming' },

    // Developer Tools
    github: { name: 'GitHub', url: 'https://www.githubstatus.com/api/v2/summary.json', category: 'developer' },
    vercel: { name: 'Vercel', url: 'https://www.vercel-status.com/api/v2/summary.json', category: 'developer' },
    netlify: { name: 'Netlify', url: 'https://www.netlifystatus.com/api/v2/summary.json', category: 'developer' },
    npm: { name: 'npm', url: 'https://status.npmjs.org/api/v2/summary.json', category: 'developer' },
    bolt: { name: 'Bolt', url: 'https://status.bolt.com/api/v2/summary.json', category: 'developer' },

    // Cloud Infrastructure
    cloudflare: { name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/summary.json', category: 'cloud' },
    digitalocean: { name: 'DigitalOcean', url: 'https://status.digitalocean.com/api/v2/summary.json', category: 'cloud' },
    linode: { name: 'Linode', url: 'https://status.linode.com/api/v2/summary.json', category: 'cloud' },

    // Other Services
    reddit: { name: 'Reddit', url: 'https://www.redditstatus.com/api/v2/summary.json', category: 'other' },
    shopify: { name: 'Shopify', url: 'https://status.shopify.com/api/v2/summary.json', category: 'other' },
    dropbox: { name: 'Dropbox', url: 'https://status.dropbox.com/api/v2/summary.json', category: 'other' }
};

// function to get the status of any one service using its API
async function getServiceStatus(serviceKey) {
    const service = services[serviceKey];
    if (!service) {
        return {
            service: 'Unknown',
            status: { description: 'Service not found', indicator: 'major' },
            last_updated: new Date().toISOString(),
            category: 'other'
        };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(service.url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'ServiceStatusDashboard/1.0'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Handle different API response formats
        let status;
        if (data.status) {
            // Standard statuspage.io format
            status = {
                description: data.status.description || 'Unknown',
                indicator: data.status.indicator || 'none'
            };
        } else if (data.page && data.page.status) {
            // Alternative format
            status = {
                description: data.page.status.description || 'Unknown',
                indicator: data.page.status.indicator || 'none'
            };
        } else {
            // Fallback
            status = {
                description: 'Operational',
                indicator: 'none'
            };
        }

        return {
            service: service.name,
            status: status,
            last_updated: new Date().toISOString(),
            category: service.category,
            incidents: data.incidents || [],
            components: data.components || []
        };

    } catch (error) {
        console.error(`Error fetching ${service.name} status:`, error.message);
        return {
            service: service.name,
            status: {
                description: 'Unable to fetch status',
                indicator: 'major'
            },
            last_updated: new Date().toISOString(),
            category: service.category,
            error: true
        };
    }
}

// sets up a separate /api/{servicename} route for each service
Object.keys(services).forEach(serviceKey => {
    app.get(`/api/${serviceKey}`, async (req, res) => {
        const result = await getServiceStatus(serviceKey);
        res.json(result);
    });
});

// hits all service APIs and returns everything together
app.get('/api/status/all', async (req, res) => {
    try {
        const results = await Promise.all(
            Object.keys(services).map(async (serviceKey) => {
                return await getServiceStatus(serviceKey);
            })
        );

        res.json({
            services: results,
            last_updated: new Date().toISOString(),
            total_services: results.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch service statuses',
            message: error.message
        });
    }
});

// for any GET route that doesn’t match an API, send back index.html
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'source', 'index.html'));
});

// starts the server and shows the message (or a test message if running in test mode)
const server = app.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'test') {
        console.log(` 404 POLICE running at http://localhost:${PORT}`);
        console.log(` Monitoring ${Object.keys(services).length} services`);
    } else {
        console.log("Ready for testing");
    }
});

module.exports = { app, server };
