import { useRef, useState } from "react";
import { Alert, Button, Container, Form, Spinner } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import myFetch from "../../hooks/myFetch";

const Signup = () => {
    const usernameRef = useRef(null);
    const emailRef = useRef(null);
    const passwordRef = useRef(null);
    const repeatPasswordRef = useRef(null);
    const navigate = useNavigate();
    const [{ creating, created, formErrors }, setState] = useState({ creating: false, created: false, formErrors: {} });

    const handleSubmit = e => {
        e.preventDefault();
        const username = usernameRef.current.value;
        const email = emailRef.current.value;
        const password = passwordRef.current.value;
        const repeatPassword = repeatPasswordRef.current.value;

        const errors = {};

        if (!email) {
            errors.email = "Email ir required";
        } else if (email.trim().length !== email.length) {
            errors.email = "Email cannot start or end with a space";
        } else if (!email.match(/^\S+@\S+\.\S+$/)) {
            errors.email = "Email format is not valid";
        }

        if (!username) {
        } else if (username.trim().length !== username.length) {
            errors.username = "Username cannot start or end with a space";
        }

        if (!password) {
            errors.password = "Password ir required";
        } else if (password.trim().length !== password.length) {
            errors.password = "Password cannot start or end with a space";
        } else if (password.length < 8) {
            errors.password = "Password too short (must be at least 8 characters long)";
        }

        if (!repeatPassword) {
            errors.repeatPassword = "Password ir required";
        } else if (repeatPassword !== password) {
            errors.repeatPassword = "Passwords do not match";
        }

        if (Object.keys(errors).length === 0) {
            setState({ created: true, creating: true, formErrors: {} });
            myFetch(
                "/api/quiz/signup",
                "POST",
                undefined,
                username.length === 0 ? { email, password } : { email, username, password },
                () => {
                    setState({ created: true, creating: false, formErrors: {} });
                },
                res => {
                    setState({ created: false, creating: false, formErrors: {} });
                    console.log(res);
                }
            );
        } else {
            setState({ created: false, creating: false, formErrors: errors });
        }
    };
    return creating ? (
        <Container fluid="sm" className="d-flex justify-content-center" style={{ marginTop: "100px" }}>
            <Spinner animation="border" variant="primary" />
        </Container>
    ) : (
        <Container fluid="sm" className="content px-3" style={{ maxWidth: "576px" }}>
            {created ? (
                <Alert variant="success">
                    <p>An email has been sent with a link to activate your account.</p>
                </Alert>
            ) : (
                <Form onSubmit={handleSubmit} noValidate>
                    <h1 className="text-center">Sign up</h1>
                    <Form.Group className="mb-3">
                        <Form.Label>Email address</Form.Label>
                        <Form.Control type="email" placeholder="Enter email" ref={emailRef} isInvalid={!!formErrors.email}></Form.Control>
                        <Form.Control.Feedback type="invalid">{formErrors.email}</Form.Control.Feedback>
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Username (optional)</Form.Label>
                        <Form.Control type="text" placeholder="Enter username" ref={usernameRef} isInvalid={!!formErrors.username}></Form.Control>
                        <Form.Control.Feedback type="invalid">{formErrors.username}</Form.Control.Feedback>
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Password</Form.Label>
                        <Form.Control type="password" placeholder="Enter password" ref={passwordRef} isInvalid={!!formErrors.password}></Form.Control>
                        <Form.Control.Feedback type="invalid">{formErrors.password}</Form.Control.Feedback>
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Repeat password</Form.Label>
                        <Form.Control type="password" placeholder="Enter password" ref={repeatPasswordRef} isInvalid={!!formErrors.repeatPassword}></Form.Control>
                        <Form.Control.Feedback type="invalid">{formErrors.repeatPassword}</Form.Control.Feedback>
                    </Form.Group>
                    <div className="d-grid">
                        <Button variant="primary" type="submit">
                            Sign up
                        </Button>
                    </div>
                    <div className="text-center">
                        <Form.Text>
                            Already a member?{" "}
                            <Link to={`/quiz/login`} className="alink">
                                Login
                            </Link>
                        </Form.Text>
                    </div>
                </Form>
            )}
        </Container>
    );
};

export default Signup;
