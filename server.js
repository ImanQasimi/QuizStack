require("dotenv").config();

const path = require("node:path");
const cors = require("cors");
const express = require("express");
const Groq = require("groq-sdk");

const app = express();
const port = process.env.PORT || 3000;
const groq = process.env.GROQ_API_KEY
    ? new Groq({ apiKey: process.env.GROQ_API_KEY })
    : null;

const QUIZZES = [
    {
        id: 1, title: "JavaScript Basics", subject: "Web Development", difficulty: "easy",
        description: "Variables, types and core language behaviour.",
        questions: [
            { id: 101, type: "multiple-choice", text: "Which keyword declares a block-scoped variable that can be reassigned?", options: ["var", "let", "const", "static"], answer: "let", explanation: "let is block-scoped and reassignable; const is block-scoped but cannot be reassigned." },
            { id: 102, type: "true-false", text: "In JavaScript, '5' === 5 evaluates to true.", options: ["True", "False"], answer: "False", explanation: "=== compares type and value. A string and a number are different types." },
            { id: 103, type: "multiple-choice", text: "What does Array.prototype.map() return?", options: ["The original array, modified", "A new array", "A single value", "undefined"], answer: "A new array", explanation: "map() builds and returns a new array without changing the original." },
            { id: 104, type: "short-answer", text: "Explain the difference between JSON.parse() and JSON.stringify(), and give one situation where you would use each.", answer: ["JSON.parse() converts JSON text into a JavaScript value, while JSON.stringify() converts a JavaScript value into JSON text. I would use JSON.parse() to read JSON received from an API and JSON.stringify() to serialize data before sending it to an API."], explanation: "JSON.parse() reads JSON text into JavaScript data; JSON.stringify() serializes JavaScript data as JSON text. Mentioning a practical use for each shows when the conversions are needed." },
        ],
    },
    {
        id: 2, title: "HTTP & Servers", subject: "Client-Server", difficulty: "medium",
        description: "Requests, responses and how a server handles them.",
        questions: [
            { id: 201, type: "multiple-choice", text: "Which HTTP status code means 'Not Found'?", options: ["200", "301", "404", "500"], answer: "404", explanation: "404 means the server can't find the requested resource." },
            { id: 202, type: "true-false", text: "A GET request should be used to submit sensitive data in the URL.", options: ["True", "False"], answer: "False", explanation: "URLs are logged and cached. Sensitive data belongs in a POST body over HTTPS." },
            { id: 203, type: "short-answer", text: "A browser needs to send login credentials to a server. Describe how you would send them and why you would not put them in the URL.", answer: ["I would send the credentials in the body of an HTTPS POST request. URLs can be stored in browser history and server logs or shared in referrer data, while HTTPS protects the request in transit."], explanation: "Credentials should be sent in a request body over HTTPS, not in a URL that may be logged, saved in browser history, or exposed through referrer data. HTTPS is needed to protect the credentials in transit." },
            { id: 204, type: "multiple-choice", text: "Which HTTP method is most appropriate for submitting quiz answers?", options: ["GET", "POST", "HEAD", "OPTIONS"], answer: "POST", explanation: "POST sends data in the request body for the server to process." },
            { id: 205, type: "true-false", text: "The server should send correct answers to the client before the quiz is submitted.", options: ["True", "False"], answer: "False", explanation: "Scoring happens server-side so students can't read answers from the network tab." },
        ],
    },
    {
        id: 3, title: "SQL Fundamentals", subject: "Databases", difficulty: "hard",
        description: "Querying, joining and designing MySQL tables.",
        questions: [
            { id: 301, type: "multiple-choice", text: "Which clause filters rows after GROUP BY?", options: ["WHERE", "HAVING", "ORDER BY", "LIMIT"], answer: "HAVING", explanation: "WHERE filters rows before grouping; HAVING filters the groups." },
            { id: 302, type: "short-answer", text: "An orders table contains many rows for each customer. Describe a query that returns each customer ID once, and explain how SQL decides which rows are duplicates.", answer: ["SELECT DISTINCT customer_id FROM orders returns each customer ID once. DISTINCT compares the values in all selected columns, so rows are duplicates when those selected values match."], explanation: "Use SELECT DISTINCT customer_id FROM orders to get unique customer IDs. DISTINCT compares every selected column, not the entire source row, so selecting additional columns can produce multiple rows for one customer." },
            { id: 303, type: "true-false", text: "A PRIMARY KEY column can contain NULL values.", options: ["True", "False"], answer: "False", explanation: "Primary keys must be unique and non-null." },
        ],
    },
];

app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

const normalize = (value) => String(value ?? "").trim().toLowerCase();

function exactShortAnswerFallback(question, answer) {
    const accepted = Array.isArray(question.answer) ? question.answer : [question.answer];
    return accepted.map(normalize).includes(normalize(answer));
}

async function gradeWithAI(quiz, answers, objectiveResults) {
    if (!groq) throw new Error("GROQ_API_KEY is not configured.");

    const shortAnswers = quiz.questions
        .filter((question) => question.type === "short-answer")
        .map((question) => ({
            id: question.id,
            question: question.text,
            expectedAnswer: question.answer,
            explanation: question.explanation,
            studentAnswer: answers[question.id] ?? "",
        }));
    const objectiveSummary = objectiveResults.map((result) => ({
        question: result.text,
        studentAnswer: result.yourAnswer,
        correctAnswer: result.correctAnswer,
        correct: result.correct,
    }));

    const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: "You are an encouraging quiz tutor. Objective question results are already fixed and must not be changed. Evaluate each short answer for semantic correctness, then provide concise, specific feedback on the student's overall performance. Return only valid JSON with assessments (array of {id, correct, feedback}), summary (string), strengths (array of strings), improvements (array of strings), and next (string). Mark an unanswered short answer incorrect.",
            },
            {
                role: "user",
                content: JSON.stringify({
                    quiz: quiz.title,
                    objectiveResults: objectiveSummary,
                    shortAnswers,
                }),
            },
        ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Groq returned an empty response.");
    const feedback = JSON.parse(content);
    if (!Array.isArray(feedback.assessments)) throw new Error("Groq returned invalid assessments.");

    return {
        assessments: feedback.assessments,
        feedback: {
            summary: typeof feedback.summary === "string" ? feedback.summary : "Your quiz has been graded.",
            strengths: Array.isArray(feedback.strengths) ? feedback.strengths.filter((item) => typeof item === "string") : [],
            improvements: Array.isArray(feedback.improvements) ? feedback.improvements.filter((item) => typeof item === "string") : [],
            next: typeof feedback.next === "string" ? feedback.next : "Review the questions you missed and try again.",
        },
    };
}

app.get("/api/quizzes", (req, res) => {
    res.json(QUIZZES.map(({ questions, ...quiz }) => ({ ...quiz, questionCount: questions.length })));
});

app.get("/api/quizzes/:id", (req, res) => {
    const quiz = QUIZZES.find((item) => item.id === Number(req.params.id));
    if (!quiz) return res.status(404).json({ error: "Quiz not found." });

    const { questions, ...details } = quiz;
    res.json({
        ...details,
        questions: questions.map(({ answer, explanation, ...question }) => question),
    });
});

app.post("/api/quizzes/:id/submit", async (req, res) => {
    const quiz = QUIZZES.find((item) => item.id === Number(req.params.id));
    if (!quiz) return res.status(404).json({ error: "Quiz not found." });

    const { answers } = req.body ?? {};
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        return res.status(400).json({ error: "Answers must be provided as an object." });
    }

    const objectiveResults = quiz.questions
        .filter((question) => question.type !== "short-answer")
        .map((question) => {
            const given = answers[question.id];
            const answered = given !== undefined && normalize(given) !== "";
            const accepted = Array.isArray(question.answer) ? question.answer : [question.answer];
            const correct = answered && accepted.map(normalize).includes(normalize(given));
            return {
                id: question.id, text: question.text, type: question.type, answered, correct,
                yourAnswer: answered ? given : null,
                correctAnswer: accepted[0], explanation: question.explanation,
            };
        });

    let shortAnswerAssessments = [];
    let feedback;
    let aiFeedbackAvailable = true;
    try {
        const aiResult = await gradeWithAI(quiz, answers, objectiveResults);
        shortAnswerAssessments = aiResult.assessments;
        feedback = aiResult.feedback;
    } catch (error) {
        aiFeedbackAvailable = false;
        console.error("Unable to generate quiz feedback:", error.message);
        shortAnswerAssessments = quiz.questions
            .filter((question) => question.type === "short-answer")
            .map((question) => ({
                id: question.id,
                correct: exactShortAnswerFallback(question, answers[question.id]),
                feedback: question.explanation,
            }));
        feedback = {
            summary: "Your quiz was scored, but AI feedback is currently unavailable.",
            strengths: [],
            improvements: ["Configure a valid GROQ_API_KEY to enable AI assessment and personalized feedback."],
            next: "Review the answer explanations below and try again.",
        };
    }

    const assessmentsById = new Map(shortAnswerAssessments.map((assessment) => [Number(assessment.id), assessment]));
    const results = quiz.questions.map((question) => {
        if (question.type !== "short-answer") {
            return objectiveResults.find((result) => result.id === question.id);
        }
        const given = answers[question.id];
        const answered = given !== undefined && normalize(given) !== "";
        const assessment = assessmentsById.get(question.id);
        const correct = answered && assessment?.correct === true;
        return {
            id: question.id, text: question.text, type: question.type, answered, correct,
            yourAnswer: answered ? given : null,
            correctAnswer: (Array.isArray(question.answer) ? question.answer : [question.answer])[0],
            explanation: assessment?.feedback || question.explanation,
        };
    });

    res.json({
        score: results.filter((result) => result.correct).length,
        total: results.length,
        results,
        feedback,
        aiFeedbackAvailable,
    });
});

app.listen(port, () => {
    console.log(`QuizStack server running at http://localhost:${port}`);
});