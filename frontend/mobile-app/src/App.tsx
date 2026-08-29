import { Redirect, Route, Switch } from "wouter";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/cases" />} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/cases/:caseId" component={CaseDetailPage} />
      <Route component={() => <Redirect to="/cases" />} />
    </Switch>
  );
}
