import { Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Container, Nav, Navbar } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";

const MyNavbar = () => {
    const user = useSelector(state => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const handleLogout = () => {
        fetch("/api/quiz/refresh/signout", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
        }).then(async res => {
            if (!res.ok) {
                const res2 = await res.json();
                console.log(res2);
            }
        });
        dispatch({ type: "SIGN_OUT" });
        navigate("/quiz/");
    };

    return (
        <Navbar collapseOnSelect expand="md" bg="dark" variant="dark">
            <Container fluid="xxl">
                <Navbar.Brand as={Link} to={`/quiz/`}>
                    QuizzMaker
                </Navbar.Brand>
                <Navbar.Toggle aria-controls="responsive-navbar-nav"></Navbar.Toggle>
                <Navbar.Collapse id="responsive-navbar-nav">
                    <Nav className="me-auto">
                        {user.roles && user.roles.includes(1) && (
                            <Fragment>
                                <Nav.Link as={Link} to={`/quiz/`}>
                                    Explore
                                </Nav.Link>
                                <Nav.Link as={Link} to={`/quiz/library`}>
                                    Library
                                </Nav.Link>
                            </Fragment>
                        )}
                        {user.roles && user.roles.includes(2) && (
                            <Fragment>
                                <Nav.Link as={Link} to={`/quiz/review`}>
                                    Review
                                </Nav.Link>
                            </Fragment>
                        )}
                        {user.roles && user.roles.includes(3) && (
                            <Fragment>
                                <Nav.Link as={Link} to={`/quiz/users`}>
                                    Users
                                </Nav.Link>
                            </Fragment>
                        )}
                    </Nav>
                    <Nav>
                        {!user.roles || user.roles.length === 0 ? (
                            <Nav.Link as={Link} to={`/quiz/login`}>
                                Log In
                            </Nav.Link>
                        ) : (
                            <Fragment>
                                <Nav.Link>{user.username ? user.username : "Anonymous"}</Nav.Link>
                                <Nav.Link onClick={handleLogout}>Log Out</Nav.Link>
                            </Fragment>
                        )}
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
};

export default MyNavbar;
