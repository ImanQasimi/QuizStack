-- QuizStack database schema (MySQL 8)
-- Run this first, then seed.sql.
--   mysql -u root -p < database/schema.sql
--   mysql -u root -p < database/seed.sql

CREATE DATABASE IF NOT EXISTS quizstack
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE quizstack;

-- Drop in reverse dependency order so the script can be re-run
DROP TABLE IF EXISTS evaluation_results;
DROP TABLE IF EXISTS evaluation_responses;
DROP TABLE IF EXISTS question_options;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS quizzes;

-- One row per quiz (the cards on the home page)
CREATE TABLE quizzes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(150) NOT NULL,
  subject     VARCHAR(100) NOT NULL,
  difficulty  ENUM('easy', 'medium', 'hard') NOT NULL,
  description VARCHAR(255) NOT NULL
);

-- One row per question. Types match the frontend exactly.
--   answer = the correct option's text (multiple-choice / true-false)
--          = the model answer (short-answer, sent to the AI)
CREATE TABLE questions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id     INT NOT NULL,
  position    INT NOT NULL,
  type        ENUM('multiple-choice', 'true-false', 'short-answer') NOT NULL,
  text        TEXT NOT NULL,
  answer      TEXT NOT NULL,
  explanation TEXT NOT NULL,
  source      VARCHAR(50)  NOT NULL,   -- 'codeprep' or 'cysecqa'
  source_ref  VARCHAR(120) NULL,       -- id/row in the original dataset
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  UNIQUE KEY uq_quiz_position (quiz_id, position)
);

-- Choices for multiple-choice and true-false questions
CREATE TABLE question_options (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  position    INT NOT NULL,
  option_text TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_question_position (question_id, position)
);

-- Labelled evaluation set: fake student answers to short-answer questions,
-- with the verdict YOU decided (the "answer key" for the AI's homework)
CREATE TABLE evaluation_responses (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  question_id    INT NOT NULL,
  student_answer TEXT NOT NULL,
  expected_label ENUM('correct', 'incorrect') NOT NULL,
  notes          VARCHAR(255) NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- One row each time the AI grades a labelled response
CREATE TABLE evaluation_results (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  response_id   INT NOT NULL,
  model         VARCHAR(100) NOT NULL,
  ai_label      ENUM('correct', 'incorrect') NOT NULL,
  ai_feedback   TEXT NULL,
  latency_ms    INT NOT NULL,
  hallucination BOOLEAN NULL,          -- filled in by a human reviewer
  run_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (response_id) REFERENCES evaluation_responses(id) ON DELETE CASCADE
);
