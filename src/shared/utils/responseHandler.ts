import { Response } from 'express';

export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: string;
    timestamp: string;
}

export class ResponseHandler {
    private static createResponse<T>(
        success: boolean,
        message: string,
        data?: T,
        error?: string
    ): ApiResponse<T> {
        return {
            success,
            message,
            data,
            error,
            timestamp: new Date().toISOString()
        };
    }

    // Success responses
    static success<T>(res: Response, data?: T, message: string = 'Success'): Response {
        const response = this.createResponse(true, message, data);
        return res.status(200).json(response);
    }

    static created<T>(res: Response, data?: T, message: string = 'Resource created successfully'): Response {
        const response = this.createResponse(true, message, data);
        return res.status(201).json(response);
    }

    static noContent(res: Response, message: string = 'No content'): Response {
        const response = this.createResponse(true, message);
        return res.status(204).json(response);
    }

    // Error responses
    static badRequest(res: Response, message: string = 'Bad request', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(400).json(response);
    }

    static unauthorized(res: Response, message: string = 'Unauthorized', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(401).json(response);
    }

    static forbidden(res: Response, message: string = 'Forbidden', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(403).json(response);
    }

    static notFound(res: Response, message: string = 'Resource not found', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(404).json(response);
    }

    static conflict(res: Response, message: string = 'Conflict', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(409).json(response);
    }

    static internalServerError(res: Response, message: string = 'Internal server error', error?: string): Response {
        const response = this.createResponse(false, message, undefined, error);
        return res.status(500).json(response);
    }

    // Generic method for custom status codes
    static custom<T>(
        res: Response,
        statusCode: number,
        success: boolean,
        message: string,
        data?: T,
        error?: string
    ): Response {
        const response = this.createResponse(success, message, data, error);
        return res.status(statusCode).json(response);
    }
}