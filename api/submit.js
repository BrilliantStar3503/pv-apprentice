const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URLSearchParams } = require('url');

export const config = { api: { bodyParser: false } };

// ─── Google Drive ─────────────────────────────────────────────────────────────
async function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function getOrCreateFolder(drive, folderName) {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
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
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return file.data.webViewLink;
}

// ─── Google Form ──────────────────────────────────────────────────────────────
function submitToGoogleForm(fields) {
  return new Promise((resolve) => {
    const formUrl = process.env.GOOGLE_FORM_SUBMIT_URL;
    if (!formUrl) return resolve(false);
    const params = new URLSearchParams({
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
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + '?' + params.toString(),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.end();
  });
}

// ─── Emails ───────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function tableRow(label, value) {
  return `<tr>
    <td style="padding:7px 10px;background:#f9f9f9;font-weight:600;color:#444;width:140px;border-bottom:1px solid #eee">${label}</td>
    <td style="padding:7px 10px;color:#333;border-bottom:1px solid #eee">${value}</td>
  </tr>`;
}

async function sendApplicantConfirmation(fields) {
  const t = createTransport();
  await t.sendMail({
    from: `"Pru Life UK PV Apprentice" <${process.env.GMAIL_USER}>`,
    to: fields.email,
    subject: 'Application Received – Pru Life UK PruVenture Apprentice',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:28px 32px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:22px">🌟 Application Received!</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Pru Life UK — PruVenture Apprentice Program</p>
        </div>
        <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
          <p style="font-size:15px;color:#333">Dear <strong>${fields.name}</strong>,</p>
          <p style="color:#555;line-height:1.7">Thank you for applying to the <strong>PruVenture Apprentice Program</strong>! We have received your application and CV. Our team will review your submission and get back to you within <strong>2–3 business days</strong>.</p>
          <h3 style="color:#C8102E;margin-top:24px;margin-bottom:12px">📋 Your Application Details</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${tableRow('Full Name', fields.name)}
            ${tableRow('Email', fields.email)}
            ${tableRow('Phone', fields.phone)}
            ${tableRow('Age Range', fields.age)}
            ${tableRow('City', fields.city)}
            ${tableRow('Experience', fields.experience)}
            ${tableRow('College Graduate', fields.graduate)}
            ${tableRow('Willingness', fields.willingness || '—')}
            ${tableRow('CV File', fields.cvFileName || '—')}
          </table>
          <p style="color:#555;margin-top:24px;line-height:1.7">We look forward to speaking with you!</p>
          <p style="color:#555">Regards,<br><strong>PruVenture Apprentice Recruitment Team</strong><br>Pru Life UK</p>
        </div>
      </div>`,
  });
}

async function sendRecruiterNotification(fields, driveLink) {
  const t = createTransport();
  const linkHtml = driveLink
    ? `<a href="${driveLink}" style="color:#C8102E">View CV on Google Drive</a>`
    : 'Not uploaded';
  await t.sendMail({
    from: `"PV Apprentice Bot" <${process.env.GMAIL_USER}>`,
    to: process.env.RECRUITER_EMAIL,
    subject: `[New Application] ${fields.name} – PruVenture Apprentice`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">📥 New PV Apprentice Application</h1>
        </div>
        <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${tableRow('Full Name', fields.name)}
            ${tableRow('Email', fields.email)}
            ${tableRow('Phone', fields.phone)}
            ${tableRow('Age Range', fields.age)}
            ${tableRow('City', fields.city)}
            ${tableRow('Experience', fields.experience)}
            ${tableRow('College Graduate', fields.graduate)}
            ${tableRow('Willingness', fields.willingness || '—')}
            ${tableRow('CV File', fields.cvFileName || '—')}
            ${tableRow('CV Drive Link', linkHtml)}
          </table>
        </div>
      </div>`,
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 10 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ success: false, error: err.message });

    const get = (v) => (Array.isArray(v) ? v[0] : v) || '';
    const data = {
      name:        get(fields.name),
      email:       get(fields.email),
      phone:       get(fields.phone),
      age:         get(fields.age),
      city:        get(fields.city),
      experience:  get(fields.experience),
      graduate:    get(fields.graduate),
      willingness: get(fields.willingness),
      cvFileName:  '',
    };

    const cvFile = files.cv ? (Array.isArray(files.cv) ? files.cv[0] : files.cv) : null;
    if (cvFile) data.cvFileName = cvFile.originalFilename || cvFile.newFilename;

    let driveLink = null;

    try {
      if (cvFile) {
        const today = new Date().toISOString().split('T')[0];
        const ext = path.extname(data.cvFileName);
        const safeName = data.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
        const driveName = `${safeName}_CV_${today}${ext}`;
        const drive = await getDriveClient();
        const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'PV Apprentice';
        const folderId = await getOrCreateFolder(drive, folderName);
        driveLink = await uploadToDrive(cvFile.filepath, driveName, cvFile.mimetype, folderId);
        fs.unlink(cvFile.filepath, () => {});
      }

      await submitToGoogleForm(data);
      await sendApplicantConfirmation(data);
      await sendRecruiterNotification(data, driveLink);

      res.status(200).json({ success: true, driveLink });
    } catch (e) {
      console.error(e);
      if (cvFile) fs.unlink(cvFile.filepath, () => {});
      res.status(500).json({ success: false, error: e.message });
    }
  });
}
