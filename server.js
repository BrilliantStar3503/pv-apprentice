require('dotenv').config();
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URLSearchParams } = require('url');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static(__dirname));

// ─── Google Drive ─────────────────────────────────────────────────────────────
async function getDriveClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json';
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function getOrCreateFolder(drive, folderName) {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  if (res.data.files.length > 0) return res.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  return folder.data.id;
}

async function uploadToDrive(filePath, fileName, mimeType, folderId) {
  const drive = await getDriveClient();
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink',
  });
  // Make it readable by anyone with the link
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return file.data.webViewLink;
}

// ─── Google Form submit ───────────────────────────────────────────────────────
function submitToGoogleForm(fields) {
  return new Promise((resolve) => {
    const formUrl = process.env.GOOGLE_FORM_SUBMIT_URL;
    if (!formUrl) return resolve(false);

    const params = new URLSearchParams({
      // Replace ENTRY_XXXXXXX values with your actual Google Form entry IDs
      'entry.ENTRY_NAME':        fields.name,
      'entry.ENTRY_EMAIL':       fields.email,
      'entry.ENTRY_PHONE':       fields.phone,
      'entry.ENTRY_AGE':         fields.age,
      'entry.ENTRY_CITY':        fields.city,
      'entry.ENTRY_EXPERIENCE':  fields.experience,
      'entry.ENTRY_GRADUATE':    fields.graduate,
      'entry.ENTRY_WILLINGNESS': fields.willingness,
    });

    const urlObj = new URL(formUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + '?' + params.toString(),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };

    const req = https.request(options, () => resolve(true));
    req.on('error', () => resolve(false));
    req.end();
  });
}

// ─── Nodemailer ───────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendApplicantConfirmation(fields) {
  const transporter = createTransport();
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:28px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">🌟 Application Received!</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Pru Life UK — PruVenture Apprentice Program</p>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:15px;color:#333">Dear <strong>${fields.name}</strong>,</p>
        <p style="color:#555;line-height:1.7">Thank you for applying to the <strong>PruVenture Apprentice Program</strong>! We have successfully received your application and CV. Our recruitment team will review your submission and get back to you within <strong>2–3 business days</strong>.</p>

        <h3 style="color:#C8102E;margin-top:24px;margin-bottom:12px">📋 Your Application Details</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${row('Full Name', fields.name)}
          ${row('Email', fields.email)}
          ${row('Phone', fields.phone)}
          ${row('Age Range', fields.age)}
          ${row('City', fields.city)}
          ${row('Experience', fields.experience)}
          ${row('College Graduate', fields.graduate)}
          ${row('Willingness', fields.willingness || '—')}
          ${row('CV File', fields.cvFileName || '—')}
        </table>

        <p style="color:#555;margin-top:24px;line-height:1.7">If you have any questions in the meantime, feel free to reach out. We look forward to speaking with you!</p>
        <p style="color:#555">Regards,<br><strong>PruVenture Apprentice Recruitment Team</strong><br>Pru Life UK</p>

        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#bbb;text-align:center">This is an automated message. Please do not reply directly to this email.</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"Pru Life UK PV Apprentice" <${process.env.GMAIL_USER}>`,
    to: fields.email,
    subject: 'Application Received – Pru Life UK PruVenture Apprentice',
    html,
  });
}

async function sendRecruiterNotification(fields, driveLink) {
  const transporter = createTransport();
  const linkHtml = driveLink
    ? `<a href="${driveLink}" style="color:#C8102E">View CV on Google Drive</a>`
    : 'Not uploaded';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">📥 New PV Apprentice Application</h1>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#555">A new application has been submitted via the PruVenture Apprentice chatbot.</p>
        <h3 style="color:#C8102E;margin-top:20px;margin-bottom:12px">Applicant Details</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${row('Full Name', fields.name)}
          ${row('Email', fields.email)}
          ${row('Phone', fields.phone)}
          ${row('Age Range', fields.age)}
          ${row('City', fields.city)}
          ${row('Experience', fields.experience)}
          ${row('College Graduate', fields.graduate)}
          ${row('Willingness', fields.willingness || '—')}
          ${row('CV File', fields.cvFileName || '—')}
          ${row('CV Drive Link', linkHtml)}
        </table>
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"PV Apprentice Bot" <${process.env.GMAIL_USER}>`,
    to: process.env.RECRUITER_EMAIL,
    subject: `[New Application] ${fields.name} – PruVenture Apprentice`,
    html,
  });
}

function row(label, value) {
  return `<tr>
    <td style="padding:7px 10px;background:#f9f9f9;font-weight:600;color:#444;width:140px;border-bottom:1px solid #eee">${label}</td>
    <td style="padding:7px 10px;color:#333;border-bottom:1px solid #eee">${value}</td>
  </tr>`;
}

// ─── Submit endpoint ──────────────────────────────────────────────────────────
app.post('/submit', upload.single('cv'), async (req, res) => {
  const { name, email, phone, age, city, experience, graduate, willingness } = req.body;
  const cvFile = req.file;

  const fields = {
    name, email, phone, age, city, experience, graduate,
    willingness: willingness || '',
    cvFileName: cvFile ? cvFile.originalname : '',
  };

  let driveLink = null;

  try {
    // 1. Upload CV to Google Drive
    if (cvFile) {
      const today = new Date().toISOString().split('T')[0];
      const ext = path.extname(cvFile.originalname);
      const safeName = name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
      const driveName = `${safeName}_CV_${today}${ext}`;

      const drive = await getDriveClient();
      const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'PV Apprentice';
      const folderId = await getOrCreateFolder(drive, folderName);
      driveLink = await uploadToDrive(cvFile.path, driveName, cvFile.mimetype, folderId);

      // Clean up temp file
      fs.unlink(cvFile.path, () => {});
    }

    // 2. Submit to Google Form
    await submitToGoogleForm(fields);

    // 3. Send emails
    await sendApplicantConfirmation(fields);
    await sendRecruiterNotification(fields, driveLink);

    res.json({ success: true, driveLink });
  } catch (err) {
    console.error('Submission error:', err);
    // Clean up temp file on error
    if (cvFile) fs.unlink(cvFile.path, () => {});
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 PruVenture Apprentice server running at http://localhost:${PORT}\n`);
});
