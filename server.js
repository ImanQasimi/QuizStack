require("dotenv").config();

const path = require("node:path");
const cors = require("cors");
const express = require("express");
const Groq = require("groq-sdk");
const quizRepository = require("./repositories/quizRepository");

const app = express();
const port = process.env.PORT || 3000;
const groq = process.env.GROQ_API_KEY
    ? new Groq({ apiKey: process.env.GROQ_API_KEY })
    : null;


app.use(cors());
app.use(express.json({ limit: "32kb" }));
for (const file of ["index.html", "style.css", "script.js"]) {
    app.get(file === "index.html" ? "/" : `/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));

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

app.get("/api/quizzes", async (req, res) => {
    res.json(await quizRepository.listQuizzes());
});

app.get("/api/quizzes/:id", (req, res) => {
    const quiz = await quizRepository.getQuiz(Number(req.params.id));
    if (!quiz) return res.status(404).json({ error: "Quiz not found." });

    const { questions, ...details } = quiz;
    res.json({
        ...details,
        questions: questions.map(({ answer, explanation, ...question }) => question),
    });
});

app.post("/api/quizzes/:id/submit", async (req, res) => {
    const quiz = await quizRepository.getQuiz(Number(req.params.id));
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
