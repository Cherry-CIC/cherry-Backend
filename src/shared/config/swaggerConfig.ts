import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Cherry Backend API',
            version: '1.0.0',
            description: 'API documentation for Cherry Backend with Firebase Authentication',
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your Firebase ID token or custom token'
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
