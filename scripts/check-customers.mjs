async function getDocs(coll) {
  const r = await fetch('https://api.engaz.tech/v1/databases/default/collections/' + coll + '/documents', {
    headers: { 'X-Branch-ID': 'main_branch' },
  });
  const j = await r.json();
  return j.documents || [];
}

const customers = await getDocs('customers');
console.log('CUSTOMERS:', customers.length);
for (const c of customers) {
  console.log(JSON.stringify({ id: c.id, name: c.name, phone: c.phone, company: c.company_id || c.companyId, points: c.points }));
}
console.log('---COMPANIES---');
const companies = await getDocs('companies');
console.log('COMPANIES:', companies.length);
for (const c of companies) {
  console.log(JSON.stringify({ id: c.id, name: c.name, phone: c.phone }));
}
