const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ verify: verifyRequestSignature }));

// Configuración
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'xcirculars_webhook_verify_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PORT = process.env.PORT || 3000;

// Configuración de escalamiento a humano
const HUMAN_AGENT_NUMBER = '+12018323326'; // Johm
const ESCALATION_KEYWORDS = ['persona', 'humano', 'agente', 'representante', 'supervisor', 'jefe', 'encargado'];
const MAX_RETRY_ATTEMPTS = 2;

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

// Almacenamiento temporal de conversaciones (en producción usar Redis/DB)
const conversations = new Map();

async function processXcircularsMessage(data) {
  const { from, name, type, content, timestamp, messageId } = data;

  console.log('🤖 Procesando para xcirculars:', {
    cliente: name,
    telefono: from,
    mensaje: content.substring(0, 100)
  });

  const lowerContent = content.toLowerCase();
  
  // Inicializar o obtener conversación
  if (!conversations.has(from)) {
    conversations.set(from, {
      name,
      messages: [],
      retryCount: 0,
      escalated: false,
      lastInteraction: Date.now()
    });
  }
  const conversation = conversations.get(from);
  conversation.messages.push({ role: 'user', content, timestamp });

  // 1. DETECTAR PALABRAS CLAVE DE ESCALAMIENTO
  const wantsHuman = ESCALATION_KEYWORDS.some(keyword => lowerContent.includes(keyword));
  
  if (wantsHuman) {
    await escalateToHuman(from, name, conversation, 'Cliente solicitó hablar con persona');
    return;
  }

  // 2. RESPUESTAS AUTOMÁTICAS
  if (lowerContent.includes('hola') || lowerContent.includes('buenos') || lowerContent.includes('buenas')) {
    conversation.retryCount = 0; // Reset contador
    await sendWhatsAppMessage(from, 
      `¡Hola ${name}! 👋\n\n` +
      `Soy Iris, asistente virtual de xcirculars.\n\n` +
      `Puedo ayudarte con:\n` +
      `• 📋 Estado de tu circular\n` +
      `• 🛠️ Soporte técnico\n` +
      `• ℹ️ Información general\n\n` +
      `Si necesitas hablar con una persona, escribe "persona".`
    );
    return;
  }
  
  if (lowerContent.includes('estado') || lowerContent.includes('circular') || lowerContent.includes('orden')) {
    conversation.retryCount = 0;
    await sendWhatsAppMessage(from,
      `Para consultar el estado de tu circular, necesito tu información. 📋\n\n` +
      `¿Cuál es el nombre de tu supermercado o tu correo registrado?`
    );
    return;
  }
  
  if (lowerContent.includes('soporte') || lowerContent.includes('ayuda') || lowerContent.includes('problema')) {
    conversation.retryCount = 0;
    await sendWhatsAppMessage(from,
      `🛠️ Soporte Técnico\n\n` +
      `Describe tu problema con detalle y te ayudaré. Si es necesario, conectaré con un agente humano.\n\n` +
      `¿Qué problema estás experimentando?`
    );
    return;
  }

  // 3. MANEJAR INFORMACIÓN DE CLIENTE (nombre de tienda/correo)
  // Si el cliente responde después de pedir estado, asumimos que da su info
  const lastBotMessage = conversation.messages.slice().reverse().find(m => m.role === 'bot');
  if (lastBotMessage?.content.includes('nombre de tu supermercado')) {
    // Aquí conectaríamos con Airtable para buscar el cliente
    conversation.retryCount = 0;
    await sendWhatsAppMessage(from,
      `Gracias ${name}. 🔍\n\n` +
      `Estoy buscando tu información en nuestro sistema...\n\n` +
      `(Próximamente: integración con Airtable para mostrar estado real)`
    );
    return;
  }

  // 4. NO ENTENDÍ → INCREMENTAR CONTADOR Y REINTENTAR
  conversation.retryCount++;
  
  if (conversation.retryCount >= MAX_RETRY_ATTEMPTS) {
    // Máximo de intentos alcanzado → Escalar
    await escalateToHuman(from, name, conversation, `No entendí después de ${MAX_RETRY_ATTEMPTS} intentos`);
  } else {
    // Reintentar con opciones claras
    await sendWhatsAppMessage(from,
      `No estoy segura de entender. 🤔\n\n` +
      `¿Puedes elegir una opción?\n` +
      `• Escribe "estado" para ver tu circular\n` +
      `• Escribe "soporte" para ayuda técnica\n` +
      `• Escribe "persona" para hablar con alguien`
    );
  }
}

// ============================================
// ESCALAR A AGENTE HUMANO
// ============================================
async function escalateToHuman(customerPhone, customerName, conversation, reason) {
  conversation.escalated = true;
  
  console.log(`🚨 ESCALANDO a humano: ${customerName} (${customerPhone}) - ${reason}`);

  // Notificar al cliente
  await sendWhatsAppMessage(customerPhone,
    `Entendido ${customerName}. 👤\n\n` +
    `Te estoy conectando con un agente humano. Por favor espera un momento...\n\n` +
    `⏱️ Tiempo estimado: 2-5 minutos`
  );

  // Notificar a Johm (agente humano)
  const conversationHistory = conversation.messages
    .map(m => `${m.role === 'user' ? '👤 Cliente' : '🤖 Bot'}: ${m.content}`)
    .join('\n');

  const notificationMessage = 
    `🚨 *NUEVO CASO ESCALADO*\n\n` +
    `*Cliente:* ${customerName}\n` +
    `*Teléfono:* ${customerPhone}\n` +
    `*Razón:* ${reason}\n` +
    `*Hora:* ${new Date().toLocaleString('es-US', { timeZone: 'America/New_York' })} EST\n\n` +
    `*Historial de conversación:*\n` +
    `${conversationHistory}\n\n` +
    `Para responder, escribe:\n` +
    `\`/responder ${customerPhone} Tu mensaje aquí\``;

  await sendWhatsAppMessage(HUMAN_AGENT_NUMBER, notificationMessage);
  
  console.log(`✅ Notificación enviada a ${HUMAN_AGENT_NUMBER}`);
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
// ENDPOINT PARA AGENTE HUMANO RESPONDER
// ============================================
app.post('/respond', async (req, res) => {
  const { to, message, agentName = 'Agente' } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: 'Faltan campos: to, message' });
  }

  console.log(`👤 ${agentName} respondiendo a ${to}: "${message.substring(0, 50)}..."`);

  // Enviar mensaje al cliente
  await sendWhatsAppMessage(to, 
    `👤 *${agentName}:*\n\n${message}\n\n` +
    `¿Hay algo más en lo que pueda ayudarte?`
  );

  // Actualizar conversación
  if (conversations.has(to)) {
    conversations.get(to).messages.push({ 
      role: 'agent', 
      content: message, 
      agent: agentName,
      timestamp: Date.now() 
    });
  }

  res.json({ success: true, message: 'Respuesta enviada' });
});

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
