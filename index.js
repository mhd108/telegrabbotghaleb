const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const db = require('./database');
const stats = require('./statistics');

const token = process.env.TELEGRAM_BOT_TOKEN;
const requiredChannelId = process.env.REQUIRED_CHANNEL_ID;
const channelInviteLink = process.env.CHANNEL_INVITE_LINK;
const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

// --- RENDER.COM KEEPALIVE ---
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('CPA Bot is Running!');
});

app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});
// ----------------------------

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not defined in .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// State management for Admin inputs
const userStates = {};

// Helper: Check if user joined the channel
async function checkSubscription(userId) {
    if (!requiredChannelId) return true; // No channel set, skip check
    try {
        const chatMember = await bot.getChatMember(requiredChannelId, userId);
        return ['creator', 'administrator', 'member'].includes(chatMember.status);
    } catch (error) {
        console.error('Error checking subscription:', error.message);
        // If error suggests channel not found or bot not admin, maybe log that.
        // For now, fail safe (allow access) or strict? Strict is better for forced sub.
        // But if config is wrong, it locks everyone out.
        // Let's return false to enforce, but ensure ID is correct.
        return false;
    }
}

// Helper: Get Main Menu Keyboard
function getMainMenu() {
    const sections = db.getSections();
    const buttons = sections.map(s => [{ text: s.title, callback_data: `view_${s.id}` }]);
    // Proxy button is now a regular section, so no need to push explicitly
    return {
        inline_keyboard: buttons
    };
}

// Command: /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Stats Tracking
    stats.registerUser(msg.from);
    stats.logInteraction(userId);

    const isJoined = await checkSubscription(userId);

    if (!isJoined) {
        await bot.sendMessage(chatId, `👋 مرحباً بك!\n\nيجب عليك الانضمام إلى القناة لاستخدام البوت:\n${channelInviteLink || ''}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'تحقق من الانضمام ✅', callback_data: 'check_join' }]
                ]
            }
        });
        return;
    }

    let text = '👋 مرحباً بك في البوت التعليمي لمجال CPA!\n\nاختر القسم الذي تريد تعلمه:';
    const opts = { reply_markup: getMainMenu() };

    // Add Admin Button if user is admin
    if (adminIds.includes(userId)) {
        text += '\n\n🔧 *لوحة التحكم للمسؤول* 👇';
        opts.reply_markup.inline_keyboard.push([{ text: '⚙️ لوحة التحكم', callback_data: 'admin_panel' }]);
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
});

// Command: /admin (Shortcut)
bot.onText(/\/admin/, async (msg) => {
    if (!adminIds.includes(msg.from.id)) return;
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '⚙️ *لوحة التحكم*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ إضافة قسم', callback_data: 'admin_add' }],
                [{ text: '❌ حذف قسم', callback_data: 'admin_delete_list' }],
                [{ text: '🔃 ترتيب الأقسام', callback_data: 'admin_reorder' }],
                [{ text: '📝 تعديل نص البروكسي', callback_data: 'admin_edit_proxy' }]
            ]
        }
    });
});

// Handle Callback Queries
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // 1. Global Subscription Check for all actions except 'check_join'
    if (data !== 'check_join') {
        const isJoined = await checkSubscription(userId);
        if (!isJoined) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ يجب الانضمام للقناة أولاً!', show_alert: true });
            await bot.sendMessage(chatId, `⚠️ عذراً، يجب عليك الانضمام إلى القناة لاستخدام البوت:\n${channelInviteLink || ''}`, {
                reply_markup: {
                    inline_keyboard: [[{ text: 'تحقق من الانضمام ✅', callback_data: 'check_join' }]]
                }
            });
            return;
        }
    }

    // 2. Check Join (Explicit button click)
    if (data === 'check_join') {
        const isJoined = await checkSubscription(userId);
        if (isJoined) {
            await bot.sendMessage(chatId, '✅ تم التحقق! يمكنك الآن استخدام البوت.', {
                reply_markup: getMainMenu()
            });
        } else {
            await bot.answerCallbackQuery(query.id, { text: '❌ لم تنضم للقناة بعد!', show_alert: true });
        }
        return;
    }

    // 2. View Section
    if (data.startsWith('view_')) {
        const sectionId = data.split('view_')[1];
        const section = db.getSection(sectionId);
        if (section) {
            await bot.sendMessage(chatId, `📚 *${section.title}*\n\n${section.content}`, { parse_mode: 'Markdown' });
        } else {
            // Fallback for legacy proxy requests if they somehow come here or if ID changed
            await bot.answerCallbackQuery(query.id, { text: 'عذراً، هذا القسم لم يعد موجوداً.', show_alert: true });
        }
        return;
    }

    // 3. Admin: Panel
    if (data === 'admin_panel') {
        if (!adminIds.includes(userId)) return;
        await bot.editMessageText('⚙️ *لوحة التحكم*', {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ إضافة قسم', callback_data: 'admin_add' }],
                    [{ text: '❌ حذف قسم', callback_data: 'admin_delete_list' }],
                    [{ text: '🔃 ترتيب الأقسام', callback_data: 'admin_reorder' }],
                    [{ text: '📝 تعديل نص البروكسي', callback_data: 'admin_edit_proxy' }],
                    [{ text: '📊 الإحصائيات (Stats)', callback_data: 'admin_stats' }],
                    [{ text: '🔙 رجوع', callback_data: 'back_home' }]
                ]
            }
        });
        return;
    }

    // 4. Admin: Add Section
    if (data === 'admin_add') {
        if (!adminIds.includes(userId)) return;
        userStates[userId] = { action: 'awaiting_title' };
        await bot.sendMessage(chatId, '📝 أرسل عنوان القسم الجديد:');
        return;
    }

    // 5. Admin: List for Delete
    if (data === 'admin_delete_list') {
        if (!adminIds.includes(userId)) return;
        const sections = db.getSections();
        const buttons = sections.map(s => [{ text: `🗑 ${s.title}`, callback_data: `delete_${s.id}` }]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('اختر القسم المراد حذفه:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 6. Admin: Perform Delete
    if (data.startsWith('delete_')) {
        if (!adminIds.includes(userId)) return;
        const sectionId = data.split('delete_')[1];
        db.deleteSection(sectionId);
        await bot.answerCallbackQuery(query.id, { text: '✅ تم الحذف بنجاح' });
        // Refresh list
        const sections = db.getSections();
        const buttons = sections.map(s => [{ text: `🗑 ${s.title}`, callback_data: `delete_${s.id}` }]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('اختر القسم المراد حذفه:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 7. Request Proxy (Legacy Handler support - though new buttons use view_ID)
    if (data === 'request_proxy') {
        const text = db.getProxyText();
        // Fallback: If migration happened, we might need to find the section manually if getProxyText fails
        // But getProxyText is updated to be safe.
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        return;
    }

    // 8. Admin: Edit Proxy Text
    if (data === 'admin_edit_proxy') {
        if (!adminIds.includes(userId)) return;
        userStates[userId] = { action: 'awaiting_proxy_text' };
        // We try to find the current text from the section
        const sections = db.getSections();
        const proxySection = sections.find(s => s.title === 'لطلب بروكسي');
        const currentText = proxySection ? proxySection.content : db.getProxyText();

        await bot.sendMessage(chatId, `📝 النص الحالي للبروكسي:\n\n"${currentText}"\n\nأرسل النص الجديد الآن:`);
        return;
    }

    // 9. Admin: Reorder Menu
    if (data === 'admin_reorder') {
        if (!adminIds.includes(userId)) return;
        const sections = db.getSections();
        const buttons = sections.map(s => [
            { text: s.title, callback_data: 'noop' },
            { text: '⬆️', callback_data: `move_up_${s.id}` },
            { text: '⬇️', callback_data: `move_down_${s.id}` }
        ]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('🔃 استخدم الأسهم لترتيب الأقسام:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 10. Admin: Move Up/Down
    if (data.startsWith('move_')) {
        if (!adminIds.includes(userId)) return;
        const parts = data.split('_'); // move, up|down, id
        const direction = parts[1];
        const sectionId = parts.slice(2).join('_'); // Join back in case ID has underscores

        db.moveSection(sectionId, direction);

        // Refresh list
        const sections = db.getSections();
        const buttons = sections.map(s => [
            { text: s.title, callback_data: 'noop' },
            { text: '⬆️', callback_data: `move_up_${s.id}` },
            { text: '⬇️', callback_data: `move_down_${s.id}` }
        ]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        try {
            await bot.editMessageText('🔃 استخدم الأسهم لترتيب الأقسام:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (err) {
            // Ignore "message is not modified" errors
        }
        return;
    }

    // 11. Start Quiz (Deprecated from UI)
    if (data === 'start_quiz') {
        const quizzes = db.getQuizzes();
        if (quizzes.length === 0) {
            await bot.answerCallbackQuery(query.id, { text: 'عذراً، لا توجد اختبارات حالياً.', show_alert: true });
            return;
        }
        // Pick random quiz
        const randomQuiz = quizzes[Math.floor(Math.random() * quizzes.length)];

        const optionButtons = randomQuiz.options.map((opt, index) => {
            return [{ text: opt, callback_data: `answer_${randomQuiz.id}_${index}` }];
        });
        optionButtons.push([{ text: '🔙 رجوع', callback_data: 'back_home' }]);

        await bot.editMessageText(`🧠 *سؤال:* ${randomQuiz.question}`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: optionButtons }
        });
        return;
    }

    // 12. Handle Quiz Answer
    if (data.startsWith('answer_')) {
        const parts = data.split('_');
        const quizId = parts[1];
        const answerIndex = parseInt(parts[2]);

        const quiz = db.getQuiz(quizId);

        if (!quiz) {
            await bot.answerCallbackQuery(query.id, { text: 'خطأ: السؤال غير موجود.', show_alert: true });
            return;
        }

        if (answerIndex === quiz.correctIndex) {
            await bot.answerCallbackQuery(query.id, { text: '✅ إجابة صحيحة! أحسنت 🎉', show_alert: true });
            // Show another question? Or go back? Let's go back to menu for now or show "Next"
            // For simplicity, let's just re-show the menu or allow another quiz
            await bot.sendMessage(chatId, '✅ إجابة صحيحة! هل تريد تجربة سؤال آخر؟', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 سؤال آخر', callback_data: 'start_quiz' }],
                        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back_home' }]
                    ]
                }
            });
        } else {
            await bot.answerCallbackQuery(query.id, { text: '❌ إجابة خاطئة، حاول مرة أخرى.', show_alert: true });
        }
        return;
    }

    // 13. Back Home
    if (data === 'back_home') {
        const text = '👋 مرحباً بك في البوت التعليمي لمجال CPA!\n\nاختر القسم الذي تريد تعلمه:';
        let opts = { reply_markup: getMainMenu() };
        if (adminIds.includes(userId)) {
            opts.reply_markup.inline_keyboard.push([{ text: '⚙️ لوحة التحكم', callback_data: 'admin_panel' }]);
        }

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...opts
        });
        return;
    }

    // 14. Admin: View Stats
    if (data === 'admin_stats') {
        if (!adminIds.includes(userId)) return;
        const report = stats.getStats();
        const recent = stats.getRecentUsers(5);

        let msgText = `📊 *إحصائيات البوت*\n\n`;
        msgText += `👥 عدد المستخدمين الكلي: ${report.totalUsers}\n`;
        msgText += `🔄 عدد التفاعلات (Start): ${report.totalInteractions}\n`;
        msgText += `📅 المستخدمين النشطين اليوم: ${report.activeToday}\n\n`;
        msgText += `🆕 *آخر 5 انضمامات:*\n`;

        recent.forEach(u => {
            msgText += `- ${u.firstName} (@${u.username || 'NoUser'})\n`;
        });

        await bot.editMessageText(msgText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'admin_panel' }]]
            }
        });
        return;
    }

    // 15. No-op
    if (data === 'noop') {
        await bot.answerCallbackQuery(query.id);
        return;
    }
});

// Handle Text Messages (for Admin Input)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!userStates[userId]) return;

    const state = userStates[userId];

    if (state.action === 'awaiting_title') {
        state.tempTitle = text;
        state.action = 'awaiting_content';
        await bot.sendMessage(chatId, `✅ العنوان: ${text}\n\nالآن أرسل محتوى الشرح لهذا القسم:`);
    } else if (state.action === 'awaiting_content') {
        const title = state.tempTitle;
        const content = text;

        db.addSection(title, content);

        delete userStates[userId]; // Clear state
        await bot.sendMessage(chatId, '✅ تم إضافة القسم بنجاح!', {
            reply_markup: {
                inline_keyboard: [[{ text: '⚙️ العودة للوحة التحكم', callback_data: 'admin_panel' }]]
            }
        });
    } else if (state.action === 'awaiting_proxy_text') {
        db.setProxyText(text);
        delete userStates[userId];
        await bot.sendMessage(chatId, '✅ تم تحديث نص طلب البروكسي بنجاح!', {
            reply_markup: {
                inline_keyboard: [[{ text: '⚙️ العودة للوحة التحكم', callback_data: 'admin_panel' }]]
            }
        });
    }
});

// Helper: Log Channel ID
bot.on('channel_post', (msg) => {
    console.log(`📢 Channel Post received! Channel ID: ${msg.chat.id}`);
    console.log(`   Title: ${msg.chat.title}`);
});

console.log('Bot is running...');
// console.log('Admin ID:', adminId);
if (!requiredChannelId) {
    console.log('⚠️ No REQUIRED_CHANNEL_ID set in .env. Mandatory subscription is disabled.');
    console.log('   To enable, send a message to the channel and check the logs for "Channel ID".');
}
