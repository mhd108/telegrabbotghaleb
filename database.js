const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

// Initialize DB if not exists
if (!fs.existsSync(DB_FILE)) {
    const initialData = {
        sections: [
            {
                id: 'cpa_intro',
                title: 'ما هو CPA؟',
                content: 'CPA تعني Cost Per Action (الدفع مقابل الإجراء). هو نموذج تسويقي يدفع فيه المعلن للناشر عند قيام المستخدم بإجراء معين مثل تعبئة استبيان أو تحميل تطبيق.'
            },
            {
                id: 'surveys',
                title: 'الربح من الاستبيانات',
                content: 'الاستبيانات هي طريقة لجمع الآراء مقابل مكافآت. للنجاح فيها يجب الصدق في الإجابة واختيار الشركات الموثوقة.'
            },
            {
                id: 'games',
                title: 'الربح من الألعاب',
                content: 'يمكنك الربح من خلال تجربة الألعاب والوصول لمستويات معينة. تتطلب هذه العروض وقتاً ولكن عوائدها قد تكون مجزية.'
            }
        ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

function readDb() {
    const data = fs.readFileSync(DB_FILE);
    return JSON.parse(data);
}

function writeDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getSections() {
    const db = readDb();

    // Migration: Check if proxyText exists and migrate it to a section
    // We do this check here to ensure it happens on runtime if data is old
    if (db.proxyText) {
        // Check if we already have a proxy section to avoid duplicates
        const exists = db.sections.find(s => s.title === 'لطلب بروكسي');
        if (!exists) {
            const newSection = {
                id: 'proxy_request_' + Date.now(),
                title: 'لطلب بروكسي',
                content: db.proxyText
            };
            db.sections.push(newSection);
            delete db.proxyText; // Remove legacy field
            writeDb(db);
            return db.sections; // Return fresh list
        }
    }

    return db.sections;
}

function addSection(title, content) {
    const db = readDb();
    const id = Date.now().toString();
    db.sections.push({ id, title, content });
    writeDb(db);
    return id;
}

function deleteSection(id) {
    const db = readDb();
    const initialLength = db.sections.length;
    db.sections = db.sections.filter(s => s.id !== id);
    writeDb(db);
    return db.sections.length < initialLength;
}

function updateSection(id, newContent) {
    const db = readDb();
    const section = db.sections.find(s => s.id === id);
    if (section) {
        section.content = newContent;
        writeDb(db);
        return true;
    }
    return false;
}

function moveSection(id, direction) {
    const db = readDb();
    const index = db.sections.findIndex(s => s.id === id);
    if (index === -1) return false;

    if (direction === 'up' && index > 0) {
        // Swap with previous
        [db.sections[index - 1], db.sections[index]] = [db.sections[index], db.sections[index - 1]];
        writeDb(db);
        return true;
    } else if (direction === 'down' && index < db.sections.length - 1) {
        // Swap with next
        [db.sections[index + 1], db.sections[index]] = [db.sections[index], db.sections[index + 1]];
        writeDb(db);
        return true;
    }
    return false;
}

function getSection(id) {
    const db = readDb();
    return db.sections.find(s => s.id === id);
}

function getQuizzes() {
    const db = readDb();
    return db.quizzes || [];
}

function getQuiz(id) {
    const db = readDb();
    return db.quizzes.find(q => q.id === id);
}

// Deprecated but kept for safety if needed, though migration handles it
function getProxyText() {
    const db = readDb();
    return db.proxyText || "⚠️ لم يتم تعيين نص مخصص لطلب البروكسي بعد.";
}

function setProxyText(text) {
    // Legacy support: add or update section named 'لطلب بروكسي'
    const db = readDb();
    const section = db.sections.find(s => s.title === 'لطلب بروكسي');
    if (section) {
        section.content = text;
    } else {
        db.sections.push({
            id: 'proxy_request_' + Date.now(),
            title: 'لطلب بروكسي',
            content: text
        });
    }
    delete db.proxyText;
    writeDb(db);
}

module.exports = {
    getSections,
    addSection,
    deleteSection,
    updateSection,
    moveSection,
    getSection,
    getQuizzes,
    getQuiz,
    getProxyText,
    setProxyText
};
