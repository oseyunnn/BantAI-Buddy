// File: analyze.js - UNIFIED AND CORRECTED

const { AzureOpenAI } = require('openai');
const { EmailClient } = require('@azure/communication-email');
const express = require('express');
const cors = require('cors');

const app = express();

// This is your allowed extension ID
const allowedOrigin = 'chrome-extension://ajkalpnppegpgejkkmgfmnobjfadlnne';

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests from your specific Chrome extension
        if (!origin || origin === allowedOrigin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

app.use(cors(corsOptions));
app.use(express.json());

// --- SECURELY GET KEYS FROM ENVIRONMENT VARIABLES ---
const connectionString = process.env["ACS_CONNECTION_STRING"];
const senderAddress = process.env["ACS_SENDER_ADDRESS"];
const endpoint = process.env["AZURE_OPENAI_ENDPOINT"];
const apiKey = process.env["AZURE_OPENAI_API_KEY"];
const apiVersion = "2025-01-01-preview";
const deployment = process.env["AZURE_DEPLOYMENT_NAME"] || 'gpt-4o';
const SYSTEM_PROMPT = process.env["AZURE_OPENAI_SYSTEM_PROMPT"];

// Initialize clients
const emailClient = new EmailClient(connectionString);
const openAIClient = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

// --- SINGLE, UNIFIED ENDPOINT FOR ANALYSIS AND NOTIFICATION ---
app.post('/api/analyze', async (req, res) => {
    // We now expect 'parentEmail' from the request body
    const { parentEmail, messageText, context } = req.body;

    if (!messageText) {
        return res.status(400).json({ error: 'Message text is required.' });
    }

    try {
        const result = await openAIClient.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `Analyze: "${messageText}"` }
            ],
            max_tokens: 800,
            temperature: 0.3,
            top_p: 0.95,
            frequency_penalty: 0,
            presence_penalty: 0,
            stop: null
        });

        const content = result.choices[0].message.content;
        const cleaned = content.replace(/^```JSON\s*|\s*```$/g, '').trim();
        const analysis = JSON.parse(cleaned);

        const shouldBlock = analysis.action === 'BLOCK' || analysis.severity >= 2;

        // --- EMAIL LOGIC IS NOW INSIDE THIS UNIFIED ENDPOINT ---
        // If the message is severe AND a parent email was provided, send the notification.
        if (shouldBlock && analysis.severity >= 3 && parentEmail && context === 'main') {
            console.log(`High severity detected. Preparing email for ${parentEmail}`);

            const emailMessage = {
                senderAddress: senderAddress, // Use the sender address from your ACS setup
                recipients: {
                    to: [{ address: parentEmail }],
                },
                content: {
                    subject: `🚨 BantAI Buddy Alert! Message Detected (Severity: ${analysis.severity}, Category: ${analysis.category})`,
                    html: `
                        <html>
                        <body style="font-family: sans-serif; line-height: 1.6;">
                            <div style="max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                                <h2 style="color: #d9534f;">🚨 BantAI Buddy Alert! 🚨</h2>
                                <p>Dear Parent/Guardian,</p>
                                <p>This is an urgent notification from <b>BantAI Buddy</b>. A message with a <b>threat level of ${analysis.severity} and a category of ${analysis.category}</b> has been detected.</p>
                                
                                <h3 style="color: #333;">Message Details:</h3>
                                <p><strong>Reason for detection:</strong> <i>"${analysis.reason}"</i></p>
                                <p style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; color: #721c24;">
                                    <strong>Original Message:</strong> "${messageText}"
                                </p>
                                
                                <p><b>This may not have been the first time your child has engaged with harmful texts.<b> Please consider having a conversation with your child about safe online communication. You can also review more details within the <b>BantAI Buddy</b> extension.</p>

                                <p>We are constantly working to make BantAI Buddy as accurate as possible, and your feedback is a vital part of that process. If you believe this message was blocked by mistake, or if you have any suggestions for improvement, please reply directly to this email. We appreciate positive stories too! Knowing what we're doing right helps us just as much.</p>
                                
                                <p>Thank you for using <b>BantAI Buddy</b> to keep your children safe online.</p>

                                <p style="font-size: 0.9em; color: #888;">The BantAI Buddy Team</p>
                            </div>
                        </body>
                        </html>
                    `
                },
            };
            
            
            // Send the email but don't wait for it to finish.
            // This makes the response to the extension faster.
            emailClient.beginSend(emailMessage)
                .then(poller => console.log(`Email send initiated to ${parentEmail}, ID: ${poller.getOperationState().id}`))
                .catch(err => console.error("ACS Email Sending Error:", err));
        } else if (shouldBlock && analysis.severity >= 3 && context === 'sidebar') {
            console.log(`High severity detected in sidebar - no email sent per configuration`);
        }

        // Return the analysis result to the extension immediately.
        res.status(200).json({
            shouldBlock: shouldBlock,
            analysis: analysis
        });

    } catch (error) {
        console.error('Backend Analysis Error:', error);

        if (error.code === 'content_filter') {
            res.status(200).json({
                shouldBlock: true,
                analysis: {
                    action: 'BLOCK',
                    category: 'CONTENT_FILTER',
                    reason: "This message was blocked by BantAI Buddy's content safety filter.",
                    severity: 5,
                    child_risk: 'CRITICAL',
                    shouldBlock: true
                }
            });
        } else {
            res.status(500).json({ error: 'Failed to analyze message.' });
        }
    }
});


// The '/send-notification' endpoint is no longer needed.
// You can delete it. The app.listen() part is also not needed for Vercel.

module.exports = app;