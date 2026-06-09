-- Run this script against your MySQL server before starting the app.

CREATE DATABASE IF NOT EXISTS flask_app;

USE flask_app;

CREATE TABLE IF NOT EXISTS items (
    id          INT          AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Optional sample data
INSERT INTO items (name, description) VALUES
    ('Sample Item 1', 'This is the first sample item.'),
    ('Sample Item 2', 'This is the second sample item.');
