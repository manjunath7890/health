const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');

// Replace with your actual MongoDB URI
const MONGO_URI = 'mongodb+srv://flyingfortress289:flyingfortress289@cluster0.zlhd1zd.mongodb.net/?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));

// Updated schema/model
const predictionSchema = new mongoose.Schema({
    hr: Number,
    spo2: Number,
    temp: Number,
    atmTemp: Number,
    gsr: Number,
    airQuality: Number,
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
    'Critical': { w: [-0.027, -1.079, -0.003, 1.392, -0.072, 0.141], b: 0.803 },
    'Mild': { w: [0.029, 0.653, -0.035, -0.133, 0.124, -0.068], b: 0.002 },
    'Moderate': { w: [-0.020, -0.655, -0.290, -1.210, -0.147, 0.135], b: -0.821 },
    'Normal': { w: [0.018, 1.080, 0.327, -0.049, 0.096, -0.208], b: 0.015 }
};

// Scoring and prediction function
function predictCondition(hr, spo2, temp, gsr, atmTemp, airQuality) {
    let scores = {};
    for (const label in weights) {
        const { w, b } = weights[label];
        // order: HR, SpO2, Temp, GSR, AtmTemp, AirQuality
        scores[label] = w[0] * hr + w[1] * spo2 + w[2] * temp + w[3] * gsr + w[4] * atmTemp + w[5] * airQuality + b;
    }
    let predicted = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    return { predicted, scores };
}


// Explanatory note function with atmTemp and airQuality
function getDynamicNote(hr, spo2, temp, gsr, atmTemp, airQuality) {
    let notes = [];

    // HR
    if (hr < 50) notes.push("Bradycardia—low HR");
    else if (hr > 130) notes.push("Tachycardia—high HR");
    else if (hr > 100) notes.push("Mild tachycardia—slightly high HR");

    // SpO2
    if (spo2 < 85) notes.push("Severe hypoxia—SpO₂ dangerously low");
    else if (spo2 < 90) notes.push("Moderate hypoxia—SpO₂ low");
    else if (spo2 < 95) notes.push("Mild hypoxemia—SpO₂ slightly low");

    // Temp
    if (temp < 0) notes.push("Sensor error: invalid body temperature reading.");
    else if (temp < 32) notes.push("Hypothermia—temp abnormally low");
    else if (temp > 40) notes.push("Severe hyperthermia—temp excessively high");
    else if (temp >= 39) notes.push("High fever");
    else if (temp >= 38) notes.push("Mild fever");
    else notes.push("Normal body temperature");

    // GSR
    if (gsr > 7) notes.push("Critical GSR—extreme stress/sweat");
    else if (gsr > 5.5) notes.push("High stress or pain (moderate GSR)");
    else if (gsr > 4) notes.push("Mild stress/sweat (mild GSR)");

    // atmTemp (ambient)
    if (isNaN(atmTemp)) notes.push("Ambient temperature data unavailable");
    else if (atmTemp < 0) notes.push("Sensor error: invalid ambient temperature reading.");
    else if (atmTemp < 10) notes.push("Very low ambient temperature");
    else if (atmTemp > 40) notes.push("Very high ambient temperature, Risk of heatstroke, UV exposure");
    else if (atmTemp < 20 || atmTemp > 30) notes.push("Uncomfortable ambient temperature, slight UV exposure risk");
    else notes.push("Comfortable ambient temperature");

    // airQuality (e.g., MQ-2 voltage or ppm)
    if (isNaN(airQuality)) notes.push("Air quality data unavailable");
    else if (airQuality < 0) notes.push("Sensor error: invalid air quality reading.");
    else if (airQuality > 1000) notes.push("Extremely hazardous: high CO, VOCs, PAHs; cancer risk.");
    else if (airQuality > 900) notes.push("Hazardous gases: CO, smoke; lung, heart damage risk");
    else if (airQuality > 800) notes.push("Very poor air: benzene, formaldehyde; respiratory, cancer risk.");
    else if (airQuality > 700) notes.push("Poor air: carcinogenic combustion by-products; asthma, lung irritation.");
    else if (airQuality > 600) notes.push("Moderate gas: VOCs and smoke; mild respiratory discomfort.");
    else if (airQuality > 500) notes.push("Slight gas elevation; monitor for ventilation or odor changes.");
    else if (airQuality >= 0) notes.push("Good air quality — minimal risk from toxic or carcinogenic gases.");
    else notes.push("Invalid air quality reading.");

    if (!notes.length) notes.push("Sensor readings are in healthy range");
    return notes.join('; ');
}

// Serve dashboard form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle form POST/prediction
app.post('/predict', async (req, res) => {
    const body = req.body;
    const hr = parseFloat(body.hr);
    const spo2 = parseFloat(body.spo2);
    const temp = parseFloat(body.temp);
    const atmTemp = parseFloat(body.atmTemp);
    const gsr = parseFloat(body.gsr);
    const airQuality = parseFloat(body.airQuality);

    if ([hr, spo2, temp, atmTemp, gsr, airQuality].some(v => isNaN(v))) {
        return res.status(400).json({ error: "Invalid or missing input" });
    }

    const { predicted } = predictCondition(hr, spo2, temp, gsr, atmTemp, airQuality);
    const note = getDynamicNote(hr, spo2, temp, gsr, atmTemp, airQuality);

    // Store in MongoDB
    try {
        const newPred = new Prediction({
            hr, spo2, temp, atmTemp, gsr, airQuality,
            predicted_condition: predicted,
            explanatory_note: note
        });
        await newPred.save();
    } catch (err) {
        console.error("MongoDB save error:", err);
    }

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

// Show recent predictions
app.get('/history', async (req, res) => {
    try {
        const records = await Prediction.find()
            .sort({ createdAt: -1 }).limit(500);

        // Table head
        const tableHead = `
            <thead>
              <tr>
                <th>Timestamp (IST)</th>
                <th>HR</th>
                <th>SpO₂</th>
                <th>Temp</th>
                <th>Atm Temp</th>
                <th>GSR</th>
                <th>Air Q.</th>
                <th>Condition</th>
                <th>Explanation</th>
              </tr>
            </thead>
        `;

        // Table rows
        const tableRows = records.map(r => `
            <tr>
                <td>${new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td>${r.hr}</td>
                <td>${r.spo2}</td>
                <td>${r.temp}</td>
                <td>${typeof r.atmTemp !== 'undefined' ? r.atmTemp : ''}</td>
                <td>${r.gsr}</td>
                <td>${typeof r.airQuality !== 'undefined' ? r.airQuality : ''}</td>
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
                </style>
            </head>
            <body>
                <div class="dashboard-header">
                  <h1 class="dashboard-title">History Table</h1>
                  <a class="nav-btn" href="/">Dashboard</a>
                </div>
                <div style="max-width:99vw;margin:0 20px;">
                  <table>
                    ${tableHead}
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

// Return last 50 prediction records for graph
app.get('/api/latest', async (req, res) => {
    try {
        const records = await Prediction.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .select('hr spo2 temp atmTemp gsr airQuality predicted_condition explanatory_note createdAt -_id');
        res.json(records.reverse());
    } catch (err) {
        res.status(500).json({ error: 'DB error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
