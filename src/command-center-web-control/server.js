const express = require('express');
const bodyParser = require('body-parser');
const csrf = require('csurf');
const crypto = require('crypto');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const csrfProtection = csrf({ cookie: true });

const jobQueue = [];
const idempotencyKeys = new Set();

app.post('/submit-job', csrfProtection, (req, res) => {
    const { job } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
        return res.status(400).json({ message: 'Idempotency key is required' });
    }

    if (idempotencyKeys.has(idempotencyKey)) {
        return res.status(409).json({ message: 'Duplicate request' });
    }

    idempotencyKeys.add(idempotencyKey);

    jobQueue.push({ job, status: 'queued' });

    res.json({ message: 'Job submitted successfully' });
});

app.get('/status', (req, res) => {
    res.json({ jobs: jobQueue });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});