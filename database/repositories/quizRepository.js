// Quiz data access (repository pattern).
// server.js calls these functions instead of reading a hardcoded array.
// The objects returned have the same shape the old QUIZZES array had,
// so the rest of server.js and the frontend work unchanged.
const pool = require("../db/connection");

// All quizzes for the home page, with a question count
async function listQuizzes() {
    const [rows] = await pool.query(`
        SELECT q.id, q.title, q.subject, q.difficulty, q.description,
               COUNT(x.id) AS questionCount
        FROM quizzes q
        LEFT JOIN questions x ON x.quiz_id = q.id
        GROUP BY q.id
        ORDER BY q.id`);
    return rows.map((row) => ({ ...row, questionCount: Number(row.questionCount) }));
}

// One quiz with its questions, options, answers and explanations.
// Returns null if the quiz doesn't exist.
async function getQuiz(id) {
    const [quizzes] = await pool.query(
        "SELECT id, title, subject, difficulty, description FROM quizzes WHERE id = ?",
        [id]
    );
    if (quizzes.length === 0) return null;

    const [questions] = await pool.query(
        `SELECT id, type, text, answer, explanation
         FROM questions WHERE quiz_id = ? ORDER BY position`,
        [id]
    );
    const [options] = await pool.query(
        `SELECT o.question_id, o.option_text
         FROM question_options o
         JOIN questions x ON x.id = o.question_id
         WHERE x.quiz_id = ?
         ORDER BY o.question_id, o.position`,
        [id]
    );

    const optionsByQuestion = new Map();
    for (const option of options) {
        if (!optionsByQuestion.has(option.question_id)) optionsByQuestion.set(option.question_id, []);
        optionsByQuestion.get(option.question_id).push(option.option_text);
    }

    return {
        ...quizzes[0],
        questions: questions.map((q) => {
            const question = { id: q.id, type: q.type, text: q.text, answer: q.answer, explanation: q.explanation };
            if (q.type === "short-answer") question.answer = [q.answer];
            else question.options = optionsByQuestion.get(q.id) || [];
            return question;
        }),
    };
}

module.exports = { listQuizzes, getQuiz };
