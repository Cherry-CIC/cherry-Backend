import { listingSafetySchemas, listingSafetyResponses } from './listingSafetyOpenApi';
import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'cherry Backend API',
            version: '1.0.0',
            description: 'API documentation for cherry Backend with Firebase Authentication',
        },
        components: {
            schemas: listingSafetySchemas,
            responses: listingSafetyResponses,
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter a Firebase ID token. Custom tokens must first be exchanged for an ID token.'
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: ['src/modules/**/routes/*.ts', 'src/modules/**/controllers/*.ts'],
};

export const swaggerSpecs = swaggerJsdoc(swaggerOptions);
