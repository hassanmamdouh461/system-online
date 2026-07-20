interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Handle CORS Preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders()
      });
    }

    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split("/").filter(Boolean);

      // Expected route format:
      // - GET/POST: /v1/databases/:dbId/collections/:collectionId/documents
      // - GET/PATCH/DELETE: /v1/databases/:dbId/collections/:collectionId/documents/:docId
      
      if (pathParts[0] !== "v1") {
        return new Response(JSON.stringify({ error: "Not Found", message: "Only /v1 endpoint is supported" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() }
        });
      }

      const dbIndex = pathParts.indexOf("databases");
      const collectionIndex = pathParts.indexOf("collections");

      if (dbIndex === -1 || collectionIndex === -1 || collectionIndex <= dbIndex) {
        return new Response(JSON.stringify({ error: "Bad Request", message: "Invalid API routing" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() }
        });
      }

      const collectionId = pathParts[collectionIndex + 1];
      const docId = pathParts[collectionIndex + 3]; // Option: /documents/:docId

      // Map Appwrite collection names to D1 database table names
      // Appwrite: 'menu_items', 'orders', 'customers', 'inventory'
      // SQLite: 'menu_items', 'orders', 'customers', 'inventory'
      const table = collectionId;

      // Check method
      const method = request.method;

      if (method === "GET") {
        if (docId) {
          // Fetch single document
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`)
            .bind(docId)
            .first();

          if (!row) {
            return new Response(JSON.stringify({ message: "Document not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...getCorsHeaders() }
            });
          }

          return new Response(JSON.stringify(denormalizeData(table, row)), {
            status: 200,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        } else {
          // Fetch all/filtered documents
          const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
          const documents = results.map(row => denormalizeData(table, row));

          return new Response(JSON.stringify({ documents }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        }
      }

      if (method === "POST") {
        // Create document
        const body: any = await request.json();
        const documentId = body.documentId;
        const rawData = body.data || {};
        
        const data = normalizeData(table, rawData);
        data.id = documentId;

        // Perform UPSERT
        const keys = Object.keys(data);
        const columns = keys.join(", ");
        const placeholders = keys.map((_, i) => `?${i + 1}`).join(", ");
        const updates = keys.filter(k => k !== "id" && k !== "createdAt" && k !== "created_at")
                            .map(k => `${k} = excluded.${k}`)
                            .join(", ");

        const sql = `
          INSERT INTO ${table} (${columns})
          VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET
            ${updates}
        `;

        const values = keys.map(k => data[k]);
        await env.DB.prepare(sql).bind(...values).run();

        // Fetch back the created row
        const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(documentId).first();
        return new Response(JSON.stringify(denormalizeData(table, row)), {
          status: 201,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() }
        });
      }

      if (method === "PATCH") {
        if (!docId) {
          return new Response(JSON.stringify({ error: "Bad Request", message: "Document ID missing" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        }

        // Update document
        const body: any = await request.json();
        const rawData = body.data || {};
        const data = normalizeData(table, rawData);

        const keys = Object.keys(data);
        if (keys.length === 0) {
          // Nothing to update, return original
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(docId).first();
          return new Response(JSON.stringify(denormalizeData(table, row)), {
            status: 200,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        }

        const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(", ");
        const sql = `UPDATE ${table} SET ${sets} WHERE id = ?1`;
        const values = keys.map(k => data[k]);

        await env.DB.prepare(sql).bind(docId, ...values).run();

        // Fetch back updated row
        const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(docId).first();
        if (!row) {
          return new Response(JSON.stringify({ message: "Document not found after patch" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        }

        return new Response(JSON.stringify(denormalizeData(table, row)), {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() }
        });
      }

      if (method === "DELETE") {
        if (!docId) {
          return new Response(JSON.stringify({ error: "Bad Request", message: "Document ID missing" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...getCorsHeaders() }
          });
        }

        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(docId).run();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() }
        });
      }

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 450,
        headers: { "Content-Type": "application/json", ...getCorsHeaders() }
      });

    } catch (err: any) {
      return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCorsHeaders() }
      });
    }
  }
};

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Appwrite-Project, X-Appwrite-Key",
    "Access-Control-Max-Age": "86400"
  };
}

function normalizeData(table: string, data: any) {
  const normalized: any = { ...data };
  
  if (table === 'orders') {
    if ('total_amount' in normalized) normalized.totalAmount = normalized.total_amount;
    if ('payment_method' in normalized) normalized.paymentMethod = normalized.payment_method;
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    
    // Remove the duplicate keys to prevent SQLite column errors
    delete normalized.total_amount;
    delete normalized.payment_method;
    delete normalized.branchId;
  }
  
  if (table === 'menu_items') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    delete normalized.branchId;
    if ('available' in normalized) {
      normalized.available = normalized.available ? 1 : 0;
    }
  }
  
  if (table === 'customers') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    delete normalized.branchId;
  }

  return normalized;
}

function denormalizeData(table: string, row: any) {
  const doc: any = { ...row };
  doc.$id = row.id;
  
  // Map created_at / updated_at / createdAt to Appwrite's metadata fields
  const created = row.createdAt || row.created_at || new Date().toISOString();
  const updated = row.updatedAt || row.updated_at || created;
  doc.$createdAt = created;
  doc.$updatedAt = updated;

  if (table === 'orders') {
    doc.totalAmount = row.totalAmount;
    doc.total_amount = row.totalAmount;
    doc.paymentMethod = row.paymentMethod;
    doc.payment_method = row.paymentMethod;
    doc.branch_id = row.branch_id;
    doc.branchId = row.branch_id;
  }
  
  if (table === 'menu_items') {
    doc.available = Boolean(row.available);
    doc.branchId = row.branch_id;
    doc.branch_id = row.branch_id;
  }
  
  if (table === 'customers') {
    doc.branchId = row.branch_id;
    doc.branch_id = row.branch_id;
  }
  
  if (table === 'inventory') {
    doc.branchId = row.branch_id;
    doc.branch_id = row.branch_id;
  }
  
  return doc;
}
