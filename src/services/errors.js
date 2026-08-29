// Typed errors so controllers can map to HTTP codes without string-matching.

class AppError extends Error {
    constructor(message, status = 400, code = 'BAD_REQUEST', details = null) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

class NotFoundError extends AppError {
    constructor(what = 'Resource') { super(`${what} not found.`, 404, 'NOT_FOUND'); }
}

class ValidationError extends AppError {
    constructor(message, details = null) { super(message, 422, 'VALIDATION_ERROR', details); }
}

/** A move that breaks the rules of Red & Black. */
class IllegalMoveError extends AppError {
    constructor(message, details = null) { super(message, 409, 'ILLEGAL_MOVE', details); }
}

class ConflictError extends AppError {
    constructor(message) { super(message, 409, 'CONFLICT'); }
}

module.exports = { AppError, NotFoundError, ValidationError, IllegalMoveError, ConflictError };
