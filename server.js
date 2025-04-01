// server.js
require('dotenv').config();
const express = require('express');
const { open } = require('sqlite'); // Use sqlite for database connection
const sqlite3 = require('sqlite3'); // Use sqlite3 as the driver
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Gemini API configuration
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables');
    process.exit(1);
}

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin === 'http://127.0.0.1:5501' || origin === `http://localhost:${port}` || origin.includes('vercel.app')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
let db;
(async () => {
    db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    });

    // Create tables
    await db.exec(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        amount REAL,
        category TEXT,
        description TEXT
    )`);

    await db.exec(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`);

    await db.exec(`CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        month TEXT,
        budget_amount REAL
    )`);

    // Seed default categories
    const count = (await db.get(`SELECT COUNT(*) as count FROM categories`)).count;
    if (count === 0) {
        const defaultCategories = ['Food', 'Travel', 'Office Supplies', 'Utilities', 'Raw Materials'];
        for (const category of defaultCategories) {
            await db.run(`INSERT INTO categories (name) VALUES (?)`, category);
        }
        console.log('Seeded default categories');
    }
})();

// --- Expense Endpoints ---
app.post('/api/expenses', async (req, res) => {
    const { date, amount, category, description } = req.body;
    try {
        if (!date || !amount || !category) {
            return res.status(400).json({ error: 'Date, amount, and category are required' });
        }
        const result = await db.run(
            `INSERT INTO expenses (date, amount, category, description) VALUES (?, ?, ?, ?)`,
            [date, amount, category, description || '']
        );
        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error('Error in POST /api/expenses:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/expenses', async (req, res) => {
    const { search, category } = req.query;
    let query = `SELECT * FROM expenses`;
    let params = [];
    if (search || category) {
        query += ` WHERE`;
        if (search) {
            query += ` (date LIKE ? OR category LIKE ? OR amount LIKE ? OR description LIKE ?)`;
            params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
        }
        if (category) {
            query += search ? ` AND category = ?` : ` category = ?`;
            params.push(category);
        }
    }
    try {
        const rows = await db.all(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/expenses:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/expenses/:id', async (req, res) => {
    const { id } = req.params;
    const { date, amount, category, description } = req.body;
    try {
        const result = await db.run(
            `UPDATE expenses SET date = ?, amount = ?, category = ?, description = ? WHERE id = ?`,
            [date, amount, category, description || '', id]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }
        res.json({ message: 'Expense updated' });
    } catch (err) {
        console.error('Error in PUT /api/expenses/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.run(`DELETE FROM expenses WHERE id = ?`, [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }
        res.json({ message: 'Expense deleted' });
    } catch (err) {
        console.error('Error in DELETE /api/expenses/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Category Endpoints ---
app.get('/api/categories', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM categories`);
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/categories:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', async (req, res) => {
    const { name } = req.body;
    try {
        if (!name) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        const result = await db.run(`INSERT INTO categories (name) VALUES (?)`, [name]);
        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error('Error in POST /api/categories:', err);
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: 'Category already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.run(`DELETE FROM categories WHERE id = ?`, [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({ message: 'Category deleted' });
    } catch (err) {
        console.error('Error in DELETE /api/categories/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Analytics Endpoint ---
app.get('/api/analytics', async (req, res) => {
    try {
        const rows = await db.all(`SELECT category, SUM(amount) as total FROM expenses GROUP BY category`);
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/analytics:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Budget Endpoints ---
app.post('/api/budgets', async (req, res) => {
    const { category, month, budget_amount } = req.body;
    try {
        if (!category || !month || !budget_amount) {
            return res.status(400).json({ error: 'Category, month, and budget amount are required' });
        }
        const result = await db.run(
            `INSERT INTO budgets (category, month, budget_amount) VALUES (?, ?, ?)`,
            [category, month, budget_amount]
        );
        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error('Error in POST /api/budgets:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/budgets', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM budgets`);
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/budgets:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/budget-status', async (req, res) => {
    try {
        const rows = await db.all(`
            SELECT b.category, b.month, b.budget_amount, SUM(e.amount) as spent
            FROM budgets b
            LEFT JOIN expenses e ON b.category = e.category
            AND strftime('%Y-%m', e.date) = b.month
            GROUP BY b.category, b.month
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/budget-status:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper function for Gemini API calls with detailed logging and fallback
async function callGeminiAPI(prompt) {
    try {
        console.log('Making Gemini API request with prompt:', prompt);

        const requestBody = {
            contents: [{
                role: "user",
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        };

        const url = `${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`;
        console.log('Gemini API URL (key redacted):', url.replace(GEMINI_API_KEY, '[REDACTED]'));
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Gemini API response status:', response.status);
        const responseData = await response.json();
        console.log('Gemini API response:', JSON.stringify(responseData, null, 2));

        if (!response.ok) {
            throw new Error(responseData.error?.message || `Gemini API error: ${response.status}`);
        }

        const replyText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!replyText) {
            throw new Error('Invalid response format from Gemini API');
        }

        return replyText;
    } catch (error) {
        console.error('Error in callGeminiAPI:', error.message);
        return "I'm sorry, I couldn't process your request due to an issue with the AI service. Please try asking something else or check your expenses manually.";
    }
}

// --- AI-Powered Insights Endpoint ---
app.post('/api/insights', async (req, res) => {
    try {
        const { expenses } = req.body;

        if (!expenses || !Array.isArray(expenses)) {
            return res.status(400).json({ error: 'Invalid expenses data provided' });
        }

        // Calculate basic financial data for context
        const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const categories = [...new Set(expenses.map(exp => exp.category))];
        const spendingByCategory = {};
        expenses.forEach(exp => {
            spendingByCategory[exp.category] = (spendingByCategory[exp.category] || 0) + exp.amount;
        });
        const highestCategory = Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0] || ['Unknown', 0];

        // Prepare context for Gemini API
        const context = `You are a financial assistant analyzing a user's expense data. Here is their recent spending data:
        - Total spent: $${totalSpent.toFixed(2)}
        - Number of categories: ${categories.length}
        - Highest spending category: ${highestCategory[0]} ($${highestCategory[1].toFixed(2)})
        - Spending by category: ${JSON.stringify(spendingByCategory)}
        Based on this data, provide 3 concise financial insights (each 1-2 sentences) to help the user manage their expenses better. Return the insights as a list of strings.`;

        // Call Gemini API to generate insights
        const aiResponse = await callGeminiAPI(context);

        // If the AI response is the fallback message, return a default set of insights
        if (aiResponse.includes("I'm sorry, I couldn't process your request")) {
            const fallbackInsights = [
                `You spent a total of $${totalSpent.toFixed(2)} across ${categories.length} categories.`,
                `Your highest spending category was ${highestCategory[0]} at $${highestCategory[1].toFixed(2)}.`,
                `Consider setting a budget for each category to better manage your expenses.`
            ];
            return res.json({ insights: fallbackInsights });
        }

        // Parse the AI response (assuming it returns a list-like format)
        const insights = aiResponse.split('\n').filter(line => line.trim()).map(line => line.replace(/^\d+\.\s*/, '').trim());
        res.json({ insights });
    } catch (error) {
        console.error('Error in /api/insights:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Chatbot Endpoint ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid message provided' });
        }

        // Get recent expenses for context
        let expenses = [];
        try {
            expenses = await db.all('SELECT * FROM expenses ORDER BY date DESC LIMIT 10');
        } catch (dbError) {
            console.error('Error fetching expenses for chat:', dbError);
            expenses = [];
        }

        let budgets = [];
        try {
            budgets = await db.all('SELECT * FROM budgets');
        } catch (dbError) {
            console.error('Error fetching budgets for chat:', dbError);
            budgets = [];
        }

        // Prepare financial context
        const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const categories = [...new Set(expenses.map(exp => exp.category))];
        const spendingByCategory = {};
        expenses.forEach(exp => {
            spendingByCategory[exp.category] = (spendingByCategory[exp.category] || 0) + exp.amount;
        });
        const highestCategory = Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0] || [' UNKNOWN', 0];

        const budgetStatus = budgets.map(b => {
            const spent = expenses
                .filter(e => e.category === b.category && e.date.startsWith(b.month))
                .reduce((sum, e) => sum + e.amount, 0);
            return `${b.category} (${b.month}): Budget $${b.budget_amount}, Spent $${spent}`;
        }).join('; ') || 'No budgets set';

        const context = `You are a financial assistant helping a user manage their expenses. Here is their recent financial data:
        - Total spent: $${totalSpent.toFixed(2)}
        - Number of categories: ${categories.length}
        - Highest spending category: ${highestCategory[0]} ($${highestCategory[1].toFixed(2)})
        - Budget status: ${budgetStatus}
        The user asked: "${message}"
        Provide a helpful, concise response (max 200 words) with actionable financial advice based on their data and question.`;

        // Call Gemini API with fallback
        const reply = await callGeminiAPI(context);

        res.json({ reply });
    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: 'Failed to process chat request: ' + error.message });
    }
});

// --- Visual Report Endpoint ---
app.get('/api/visual-report', async (req, res) => {
    try {
        const expenses = await db.all('SELECT category, SUM(amount) as total FROM expenses GROUP BY category');
        const total = expenses.reduce((sum, exp) => sum + exp.total, 0);
        const percentages = expenses.map(exp => `${exp.category}: ${(exp.total / total * 100).toFixed(0)}%`).join(', ');

        const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: `A colorful pie chart showing ${percentages}`
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate image');
        }

        const imageBuffer = await response.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');
        res.json({ image: `data:image/png;base64,${imageBase64}` });
    } catch (err) {
        console.error('Error in /api/visual-report:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve index.html for all non-API routes (for client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server with error handling
app.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
    console.log(`Server running at http://localhost:${port}`);
});