import { Redirect, Route, Switch } from "wouter";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import LiveBridgePage from "./pages/LiveBridgePage";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/cases" />} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/cases/:caseId" component={CaseDetailPage} />
      <Route path="/bridge/:caseId" component={LiveBridgePage} />
      <Route path="/bridge" component={() => <Redirect to="/cases" />} />
      <Route path="/trace" component={() => <Redirect to="/cases" />} />
      <Route path="/governance-proof" component={() => <Redirect to="/cases" />} />
      <Route component={() => <Redirect to="/cases" />} />
    </Switch>
  );
}
