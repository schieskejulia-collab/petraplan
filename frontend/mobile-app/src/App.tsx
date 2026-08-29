import { Route, Switch } from "wouter";

import Home from "./pages/Home";
import Upload from "./pages/Upload";
import AnalyzePage from "./pages/AnalyzePage";
import HistoryPage from "./pages/HistoryPage";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import ResultsPage from "./pages/results";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/upload" component={Upload} />
      <Route path="/analyse" component={AnalyzePage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/cases/:caseId" component={CaseDetailPage} />
      <Route path="/results" component={ResultsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}