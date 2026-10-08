import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'cherry backend API',
      version: '1.0.0',
      description:
        'API documentation for cherry backend with Firebase Authentication',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter a Firebase ID token. Custom tokens must first be exchanged for an ID token.',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    'src/modules/**/routes/*.ts',
    'src/modules/**/controllers/*.ts',
    'src/modules/account-deletion/routes.ts',
  ],
};

export const swaggerSpecs = swaggerJsdoc(swaggerOptions);
