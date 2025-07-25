const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');

// Replace with your actual MongoDB URI
const MONGO_URI = 'mongodb+srv://flyingfortress289:flyingfortress289@cluster0.zlhd1zd.mongodb.net/?retryWrites=true&w=majority'; // local dev example

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));

// Define a schema/model
const predictionSchema = new mongoose.Schema({
    hr: Number,
    spo2: Number,
    temp: Number,
    gsr: Number,
    predicted_condition: String,
    explanatory_note: String,
    createdAt: { type: Date, default: Date.now }
});

const Prediction = mongoose.model('Prediction', predictionSchema);


const app = express();
const PORT = 7000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(__dirname));

// Logistic regression weights from your model
const weights = {
    'Critical': { w: [0.017, -0.336, -0.877, 0.769], b: 59.584 },
    'Mild': { w: [0.006, 0.106, 0.524, 0.203], b: -30.189 },
    'Moderate': { w: [-0.009, 0.052, 0.439, -0.139], b: -19.240 },
    'Normal': { w: [-0.015, 0.178, -0.086, -0.833], b: -10.155 }
};

// Scoring and prediction function
function predictCondition(hr, spo2, temp, gsr) {
    let scores = {};
    for (const label in weights) {
        const { w, b } = weights[label];
        scores[label] = w[0] * hr + w[1] * spo2 + w[2] * temp + w[3] * gsr + b;
    }
    let predicted = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    return { predicted, scores };
}

// Explanatory note function
function getDynamicNote(hr, spo2, temp, gsr) {
    let notes = [];
    if (hr < 50) notes.push("Bradycardia—low HR");
    else if (hr > 130) notes.push("Tachycardia—high HR");
    if (spo2 < 85) notes.push("Severe hypoxia—SpO₂ dangerously low");
    else if (spo2 < 90) notes.push("Moderate hypoxia—SpO₂ low");
    else if (spo2 < 95) notes.push("Mild hypoxemia—SpO₂ slightly low");
    if (temp < 34) notes.push("Severe hypothermia—very low temp");
    else if (temp > 40) notes.push("Severe hyperthermia—temp excessively high");
    else if (temp >= 39) notes.push("High fever");
    else if (temp >= 38) notes.push("Mild fever");
    if (gsr > 7) notes.push("Critical GSR—extreme stress/sweat");
    else if (gsr > 5.5) notes.push("High stress or pain (moderate GSR)");
    else if (gsr > 4) notes.push("Mild stress/sweat (mild GSR)");
    if (!notes.length) notes.push("All sensors in healthy range");
    return notes.join('; ');
}

// Serve the form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle form POST
app.post('/predict', async (req, res) => {
    // Support both JSON and urlencoded body
    const body = req.body;
    const hr = parseFloat(body.hr);
    const spo2 = parseFloat(body.spo2);
    const temp = parseFloat(body.temp);
    const gsr = parseFloat(body.gsr);

    if ([hr, spo2, temp, gsr].some(v => isNaN(v))) {
        return res.status(400).json({ error: "Invalid or missing input" });
    }

    const { predicted } = predictCondition(hr, spo2, temp, gsr);
    const note = getDynamicNote(hr, spo2, temp, gsr);

    // ---- Store in MongoDB ----
    try {
        const newPred = new Prediction({
            hr, spo2, temp, gsr,
            predicted_condition: predicted,
            explanatory_note: note
        });
        await newPred.save();
    } catch (err) {
        console.error("MongoDB save error:", err);
        // Optional: handle DB error but still respond (depends on your use-case)
    }

    // Respond as before...
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.json({
            predicted_condition: predicted,
            explanatory_note: note
        });
    }
    res.send(`
        <h2>Health Prediction Result</h2>
        <p><strong>Predicted Condition:</strong> ${predicted}</p>
        <p><strong>Explanation:</strong> ${note}</p>
        <br>
        <a href="/">Try Again</a>
    `);
});

app.get('/history', async (req, res) => {
    try {
        const records = await Prediction.find()
            .sort({ createdAt: -1 }).limit(500); // Most recent 50

        // Build table rows with IST timestamps
        const tableRows = records.map(r => `
            <tr>
                <td>${new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td>${r.hr}</td>
                <td>${r.spo2}</td>
                <td>${r.temp}</td>
                <td>${r.gsr}</td>
                <td>
                    <span class="cond cond-normal" style="display:${r.predicted_condition === "Normal" ? "inline-block" : "none"}">Normal</span>
                    <span class="cond cond-mild" style="display:${r.predicted_condition === "Mild" ? "inline-block" : "none"}">Mild</span>
                    <span class="cond cond-moderate" style="display:${r.predicted_condition === "Moderate" ? "inline-block" : "none"}">Moderate</span>
                    <span class="cond cond-critical" style="display:${r.predicted_condition === "Critical" ? "inline-block" : "none"}">Critical</span>
                </td>
                <td style="max-width:350px;overflow-x:auto;white-space:pre-line">${r.explanatory_note}</td>
            </tr>
        `).join('\n');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Prediction History</title>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI',Arial,sans-serif; background: #f4f8fb; margin:0;}
                    .dashboard-header {
                        display: flex; justify-content: space-between; align-items: center;
                        padding: 10px 35px; background: #fff; box-shadow: 0 2px 8px #0001;
                    } 
                   .dashboard-title { color: #1d2536; font-size: 2.7rem; margin: 0; font-weight: 700;}
                   .nav-btn {
                        display:inline-block; padding:8px 21px;background:#317fd8;
                        color:#fff;text-decoration:none;border-radius:7px;
                        font-size: 17px;font-weight:500;transition:background .2s;
                 }
                    .nav-btn:hover {background:#0656b1;}
                    h1 { color: #1d2536; font-size: 1.5rem; margin: 24px 0 16px 0; }
                    table {
                        width: 98%; margin: 30px auto 0 auto;
                        border-collapse: collapse; background: #fff;
                        box-shadow: 0 2px 10px #0001; border-radius: 9px;
                    }
                    th, td { padding: 10px 12px; border: 1px solid #e8eaef; text-align: center; }
                    th { background: #f3f7fa; color:#333; font-weight: 600;}
                    tr:nth-child(even) { background: #f6fafd; }
                    .cond { font-size: 1em; font-weight: bold; color: #fff; padding: 2px 14px; border-radius: 5px;}
                    .cond-normal { background: #5d92ceff;}
                    .cond-mild { background: #f1d87bff; color:#232325;}
                    .cond-moderate { background: #e79a5aff;}
                    .cond-critical { background: #d16a62ff;}
                    @media (max-width: 700px) {
                        .topbar{padding: 12px 10px;}
                        .topbar-title{font-size:1.3rem;}
                        table{width:99vw;}
                    }
                </style>
            </head>
            <body>
                <div class="dashboard-header">
                    <h1 class="dashboard-title">History Table</h1>
                    <a class="nav-btn" href="/">Dashboard</a>
                </div>
                <div style="max-width:99vw;margin:0 20px;">
                    <table>
                        <thead>
                            <tr>
                                <th>Timestamp (IST)</th>
                                <th>HR</th>
                                <th>SpO₂</th>
                                <th>Temp</th>
                                <th>GSR</th>
                                <th>Condition</th>
                                <th>Explanation</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error fetching history");
    }
});



// Return last 10 prediction records for graph
app.get('/api/latest', async (req, res) => {
    try {
        const records = await Prediction.find()
            .sort({ createdAt: -1 }) // newest first
            .limit(50)               // last 10 records
            .select('hr spo2 temp gsr predicted_condition explanatory_note createdAt -_id'); // relevant fields only
        // Chart or dashboard expects oldest first
        res.json(records.reverse());
    } catch (err) {
        res.status(500).json({ error: 'DB error' });
    }
});




// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
