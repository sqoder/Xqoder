export interface UserV2 {
    id: string;
    firstName: string;
    lastName?: string;
    email: string;
}

export interface UserResponse {
    id: string;
    email: string;
}

export function buildUserResponse(user: UserV2): UserResponse {
    return {
        id: user.id,
        email: user.email,
    };
}
