import PDFDocument from 'pdfkit';

// Render the structured CV (see /api/cv) to a clean one-column, ATS-friendly PDF buffer.
export function renderCvPdf(cv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = '#0B6B3A';
    const h = t => { doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).fillColor(accent).text(t.toUpperCase());
      doc.moveTo(50, doc.y + 1).lineTo(545, doc.y + 1).strokeColor(accent).lineWidth(0.7).stroke(); doc.moveDown(0.4).fillColor('#111'); };
    const p = (t, o = {}) => doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor('#111').text(t, o);

    p(cv.fullName || 'Curriculum Vitae', { bold: true, size: 20 });
    const contact = [cv.email, cv.phone, cv.location].filter(Boolean).join('  |  ');
    if (contact) doc.font('Helvetica').fontSize(10).fillColor('#444').text(contact);
    if (cv.links?.length) doc.fillColor('#444').text(cv.links.join('  |  '));

    if (cv.summary) { h('Professional Summary'); p(cv.summary); }
    if (cv.education?.length) {
      h('Education');
      for (const e of cv.education) {
        p(`${e.qualification || ''}${e.field ? ' in ' + e.field : ''}${e.classOfDegree ? ' (' + e.classOfDegree + ')' : ''}`, { bold: true });
        p([e.institution, e.years].filter(Boolean).join(' - '), { size: 9.5 });
        doc.moveDown(0.3);
      }
    }
    if (cv.certifications?.length) {
      h('Certifications');
      for (const c of cv.certifications) p(`• ${[c.name, c.issuer, c.year].filter(Boolean).join(' - ')}`);
    }
    if (cv.experience?.length) {
      h('Experience');
      for (const x of cv.experience) {
        p(`${x.role || ''}${x.organisation ? ', ' + x.organisation : ''}`, { bold: true });
        if (x.period) p(x.period, { size: 9.5 });
        for (const b of x.bullets || []) p(`• ${b}`, { indent: 8 });
        doc.moveDown(0.3);
      }
    }
    if (cv.skills?.length) { h('Skills'); p(cv.skills.join('  •  ')); }
    if (cv.referees) { h('Referees'); p(cv.referees); }
    doc.end();
  });
}
