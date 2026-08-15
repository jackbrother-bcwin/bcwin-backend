const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
} as const;

type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

export { HTTP_STATUS, HttpStatusCode };
