'use strict';

const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Google Auth ──────────────────────────────────────────────────────────────
async function getAuthClient(scopes) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

// ─── Google Drive ─────────────────────────────────────────────────────────────
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

async function uploadToDrive(filePath, fileName, mimeType) {
  const auth = await getAuthClient(['https://www.googleapis.com/auth/drive']);
  const drive = google.drive({ version: 'v3', auth });
  const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'PV Apprentice';
  const folderId = await getOrCreateFolder(drive, folderName);
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

// ─── Google Sheets ────────────────────────────────────────────────────────────
async function appendToSheet(fields, driveLink) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;
  const auth = await getAuthClient(['https://www.googleapis.com/auth/spreadsheets']);
  const sheets = google.sheets({ version: 'v4', auth });
  const timestamp = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  const cvLinkCell = driveLink ? `=HYPERLINK("${driveLink}","View CV")` : '—';

  const check = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Leads!A1' });
  if (!check.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: 'Leads!A1', valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Timestamp','Sender ID','Page ID','Message','User Type','Lead Status','Name','Phone','Email','Preferred Meeting','Area','Appointment Date','AI Response','Escalate','Escalation Reason','Status','Support Needed','crm_status','reason','Remarks']] },
    });
  }

  const leadStatus = fields.qualified === 'No' ? 'Not Qualified' : 'Qualified';
  const remarks = [
    `CV: ${fields.cvFileName || '—'}`,
    cvLinkCell,
    fields.disqualifyRemarks ? `⚠️ ${fields.disqualifyRemarks}` : '',
  ].filter(Boolean).join(' | ');

  await sheets.spreadsheets.values.append({
    spreadsheetId, range: 'Leads!A:T', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[
      timestamp, '', 'PV Apprentice Chatbot', '', 'Applicant', leadStatus,
      fields.name, fields.phone, fields.email, '', fields.city, '', '', '', '',
      'Applied',
      `Age: ${fields.age} | Exp: ${fields.experience} | Graduate: ${fields.graduate} | ${fields.willingness || '—'}`,
      'New Lead', '',
      remarks,
    ]] },
  });
}

// ─── Email ────────────────────────────────────────────────────────────────────
function tr(label, value) {
  return `<tr><td style="padding:7px 10px;background:#f9f9f9;font-weight:600;color:#444;width:140px;border-bottom:1px solid #eee">${label}</td><td style="padding:7px 10px;color:#333;border-bottom:1px solid #eee">${value}</td></tr>`;
}

function mailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

async function sendApplicantEmail(fields) {
  await mailer().sendMail({
    from: `"Pru Life UK PV Apprentice" <${process.env.GMAIL_USER}>`,
    to: fields.email,
    subject: 'Application Received – Pru Life UK PruVenture Apprentice',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:28px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">🌟 Application Received!</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Pru Life UK — PruVenture Apprentice Program</p>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
        <p>Dear <strong>${fields.name}</strong>,</p>
        <p style="color:#555;line-height:1.7">Thank you for applying to the <strong>PruVenture Apprentice Program</strong>! We have received your application. Our team will review your submission and get back to you within <strong>2–3 business days</strong>.</p>
        <h3 style="color:#C8102E">📋 Your Application Details</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${tr('Full Name', fields.name)}
          ${tr('Email', fields.email)}
          ${tr('Phone', fields.phone)}
          ${tr('Age Range', fields.age)}
          ${tr('City', fields.city)}
          ${tr('Experience', fields.experience)}
          ${tr('Graduate', fields.graduate)}
          ${tr('Willingness', fields.willingness || '—')}
          ${tr('CV File', fields.cvFileName || '—')}
        </table>
        <p style="color:#555;margin-top:24px">Regards,<br><strong>PruVenture Apprentice Recruitment Team</strong><br>Pru Life UK</p>
      </div>
    </div>`,
  });
}

async function sendRecruiterEmail(fields, driveLink) {
  const linkHtml = driveLink ? `<a href="${driveLink}">View CV on Google Drive</a>` : '—';
  await mailer().sendMail({
    from: `"PV Apprentice Bot" <${process.env.GMAIL_USER}>`,
    to: process.env.RECRUITER_EMAIL,
    subject: `[New Application] ${fields.name} – PruVenture Apprentice`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#8B0000,#C8102E);padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">📥 New PV Apprentice Application</h1>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${tr('Full Name', fields.name)}
          ${tr('Email', fields.email)}
          ${tr('Phone', fields.phone)}
          ${tr('Age Range', fields.age)}
          ${tr('City', fields.city)}
          ${tr('Experience', fields.experience)}
          ${tr('Graduate', fields.graduate)}
          ${tr('Willingness', fields.willingness || '—')}
          ${tr('CV File', fields.cvFileName || '—')}
          ${tr('CV Link', linkHtml)}
        </table>
      </div>
    </div>`,
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = new IncomingForm({
    maxFileSize: 10 * 1024 * 1024,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }

    const get = (v) => (Array.isArray(v) ? v[0] : v) || '';
    const data = {
      name:               get(fields.name),
      email:              get(fields.email),
      phone:              get(fields.phone),
      age:                get(fields.age),
      city:               get(fields.city),
      experience:         get(fields.experience),
      graduate:           get(fields.graduate),
      willingness:        get(fields.willingness),
      qualified:          get(fields.qualified) || 'Yes',
      disqualifyRemarks:  get(fields.disqualifyRemarks) || '',
      cvFileName:         '',
    };

    const cvFile = files.cv ? (Array.isArray(files.cv) ? files.cv[0] : files.cv) : null;
    if (cvFile) data.cvFileName = cvFile.originalFilename || cvFile.newFilename;

    let driveLink = null;

    try {
      // 1. Upload CV to Google Drive
      if (cvFile && cvFile.filepath) {
        const today = new Date().toISOString().split('T')[0];
        const ext = path.extname(data.cvFileName);
        const safeName = data.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
        const driveName = `${safeName}_CV_${today}${ext}`;
        driveLink = await uploadToDrive(cvFile.filepath, driveName, cvFile.mimetype || 'application/octet-stream');
        fs.unlink(cvFile.filepath, () => {});
      }

      // 2. Append to Google Sheets
      await appendToSheet(data, driveLink);

      // 3. Send emails
      await sendApplicantEmail(data);
      await sendRecruiterEmail(data, driveLink);

      res.status(200).json({ success: true, driveLink });
    } catch (e) {
      console.error('Submission error:', e);
      if (cvFile && cvFile.filepath) fs.unlink(cvFile.filepath, () => {});
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
