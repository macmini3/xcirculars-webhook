const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ verify: verifyRequestSignature }));

// Configuración
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'xcirculars_webhook_verify_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PORT = process.env.PORT || 3000;

// Número de Johm para soporte humano
const JOHM_NUMBER = '+12018323326';

// Verificación de firma de Meta (seguridad)
function verifyRequestSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !process.env.APP_SECRET) return;
  
  const expected = crypto
    .createHmac('sha256', process.env.APP_SECRET)
    .update(buf)
    .digest('hex');
  
  if (signature !== `sha256=${expected}`) {
    throw new Error('Firma de webhook inválida');
  }
}

// ============================================
// ENDPOINT DE VERIFICACIÓN (GET /webhook)
// ============================================
// Meta envía: GET /webhook?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=YYY
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Verificación recibida:', { mode, token: token?.substring(0, 10) + '...' });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado exitosamente');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación fallida - token no coincide');
    res.sendStatus(403);
  }
});

// ============================================
// ENDPOINT PARA RECIBIR MENSAJES (POST /webhook)
// ============================================
app.post('/webhook', async (req, res) => {
  const body = req.body;

  console.log('📨 Webhook recibido:', JSON.stringify(body, null, 2));

  // Confirmar recepción inmediatamente (Meta espera 200 OK rápido)
  res.status(200).send('EVENT_RECEIVED');

  // Procesar el mensaje
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // Mensaje recibido
        if (value.messages) {
          for (const message of value.messages) {
            await handleIncomingMessage(message, value);
          }
        }

        // Estado de mensaje enviado (delivered, read, failed)
        if (value.statuses) {
          for (const status of value.statuses) {
            handleMessageStatus(status);
          }
        }
      }
    }
  }
});

// ============================================
// MANEJADOR DE MENSAJES ENTRANTES
// ============================================
async function handleIncomingMessage(message, value) {
  const from = message.from; // Número del remitente (ej: 5215512345678)
  const name = value.contacts?.[0]?.profile?.name || 'Desconocido';
  
  console.log(`📱 Mensaje de ${name} (${from}):`);

  // Extraer contenido según tipo de mensaje
  let content = '';
  let type = message.type;

  switch (message.type) {
    case 'text':
      content = message.text?.body || '';
      console.log(`   📝 Texto: "${content}"`);
      break;
    
    case 'image':
      content = '[Imagen]';
      console.log(`   🖼️ Imagen recibida (ID: ${message.image?.id})`);
      break;
    
    case 'document':
      content = `[Documento: ${message.document?.filename}]`;
      console.log(`   📄 Documento: ${message.document?.filename}`);
      break;
    
    case 'audio':
    case 'voice':
      content = '[Audio/Voz]';
      console.log(`   🎵 Audio recibido`);
      break;
    
    case 'location':
      const loc = message.location;
      content = `[Ubicación: ${loc?.latitude}, ${loc?.longitude}]`;
      console.log(`   📍 Ubicación: ${loc?.latitude}, ${loc?.longitude}`);
      break;
    
    case 'button':
      content = message.button?.text || '';
      console.log(`   🔘 Botón: "${content}"`);
      break;
    
    case 'interactive':
      const interactive = message.interactive;
      if (interactive?.type === 'button_reply') {
        content = interactive.button_reply?.title || '';
        console.log(`   🔘 Respuesta botón: "${content}"`);
      } else if (interactive?.type === 'list_reply') {
        content = interactive.list_reply?.title || '';
        console.log(`   📋 Respuesta lista: "${content}"`);
      }
      break;
    
    default:
      content = `[Tipo: ${message.type}]`;
      console.log(`   ❓ Tipo desconocido: ${message.type}`);
  }

  // Aquí conectamos con la lógica de xcirculars
  await processXcircularsMessage({
    from,
    name,
    type,
    content,
    timestamp: message.timestamp,
    messageId: message.id,
    raw: message
  });
}

// ============================================
// LÓGICA DE PROCESAMIENTO (xcirculars)
// ============================================
async function processXcircularsMessage(data) {
  const { from, name, type, content } = data;
  const lowerContent = content.toLowerCase();

  console.log('🤖 Procesando:', { cliente: name, mensaje: content.substring(0, 50) });

  // 1. SALUDO
  if (lowerContent.includes('hola') || lowerContent.includes('buenos') || lowerContent.includes('buenas')) {
    await sendWhatsAppMessage(from, 
      `¡Hola ${name}! 👋\n\n` +
      `Soy Iris, asistente de xcirculars.\n\n` +
      `¿En qué puedo ayudarte?\n` +
      `• Estado de tu circular\n` +
      `• Soporte técnico\n` +
      `• Información general`
    );
    return;
  }
  
  // 2. ESTADO DE CIRCULAR
  if (lowerContent.includes('estado') || lowerContent.includes('circular') || lowerContent.includes('orden')) {
    await sendWhatsAppMessage(from,
      `Para consultar tu circular, necesito tu nombre de tienda o correo. 📋\n\n` +
      `¿Cuál es el nombre de tu supermercado?`
    );
    return;
  }
  
  // 3. SOPORTE - DAR NÚMERO DE JOHM DIRECTAMENTE
  if (lowerContent.includes('soporte') || lowerContent.includes('ayuda') || lowerContent.includes('problema')) {
    await sendWhatsAppMessage(from,
      `🛠️ Soporte Técnico\n\n` +
      `Para ayuda directa, contacta a Johm:\n\n` +
      `📞 ${JOHM_NUMBER}\n\n` +
      `Escríbele por WhatsApp.`
    );
    return;
  }

  // 4. ESCALAR A PERSONA - SOLO DAR NÚMERO
  const wantsHuman = ['persona', 'humano', 'agente', 'representante'].some(k => lowerContent.includes(k));
  
  if (wantsHuman) {
    await sendWhatsAppMessage(from,
      `Entendido. Te paso el contacto de Johm:\n\n` +
      `📞 ${JOHM_NUMBER}\n\n` +
      `Escríbele directamente.`
    );
    return;
  }

  // 5. NO ENTENDÍ
  await sendWhatsAppMessage(from,
    `No estoy segura de entender. 🤔\n\n` +
    `Opciones:\n` +
    `• "estado" - Ver tu circular\n` +
    `• "soporte" - Ayuda técnica\n` +
    `• "persona" - Hablar con Johm`
  );
}

// ============================================
// ENVIAR MENSAJE DE WHATSAPP
// ============================================
async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN) {
    console.log('⚠️ WHATSAPP_TOKEN no configurado - no se puede enviar respuesta');
    return;
  }

  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '981887568348921';
  
  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text }
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Mensaje enviado:', result.messages?.[0]?.id);
    } else {
      console.log('❌ Error enviando mensaje:', result);
    }
  } catch (error) {
    console.error('💥 Error de red:', error.message);
  }
}

// ============================================
// ESTADO DE MENSAJES ENVIADOS
// ============================================
function handleMessageStatus(status) {
  const statusMap = {
    'sent': '✉️ Enviado',
    'delivered': '✅ Entregado',
    'read': '👁️ Leído',
    'failed': '❌ Fallido'
  };

  console.log(`${statusMap[status.status] || status.status} - ID: ${status.id}`);
  
  if (status.status === 'failed') {
    console.log('   Error:', status.errors);
  }
}



// ============================================
// ENDPOINTS DE SALUD
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'xcirculars-webhook',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    healthy: true,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║     xcirculars Webhook Server - Meta WhatsApp      ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT.toString().padEnd(40)} ║`);
  console.log(`║  Verify Token: ${VERIFY_TOKEN.substring(0, 20)}...${' '.repeat(17)} ║`);
  console.log(`║  WhatsApp Token: ${WHATSAPP_TOKEN ? '✅ Configurado' : '⚠️  No configurado'}${' '.repeat(24)} ║`);
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /webhook  - Verificación de Meta`);
  console.log(`  POST /webhook  - Recepción de mensajes`);
  console.log(`  GET  /health   - Estado del servicio`);
});
