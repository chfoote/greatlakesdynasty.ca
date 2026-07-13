import { BrowserRouter as Router, Routes, Route } from "react-router";
import SignIn from "./pages/AuthPages/SignIn";
import SignUp from "./pages/AuthPages/SignUp";
import NotFound from "./pages/OtherPage/NotFound";
import UserProfiles from "./pages/UserProfiles";
import Videos from "./pages/UiElements/Videos";
import Images from "./pages/UiElements/Images";
import Alerts from "./pages/UiElements/Alerts";
import Badges from "./pages/UiElements/Badges";
import Avatars from "./pages/UiElements/Avatars";
import Buttons from "./pages/UiElements/Buttons";
import LineChart from "./pages/Charts/LineChart";
import BarChart from "./pages/Charts/BarChart";
import Calendar from "./pages/Calendar";
import BasicTables from "./pages/Tables/BasicTables";
import FormElements from "./pages/Forms/FormElements";
import Blank from "./pages/Blank";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import Home from "./pages/Dashboard/Home";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AdminRoute from "./components/auth/AdminRoute";
import Standings from "./pages/League/Standings";
import Teams from "./pages/League/Teams";
import Transactions from "./pages/League/Transactions";
import BatterStats from "./pages/League/BatterStats";
import PitcherStats from "./pages/League/PitcherStats";
import PlayerProfile from "./pages/League/PlayerProfile";
import TeamAdmin from "./pages/League/TeamAdmin";
import TeamDetail from "./pages/League/TeamDetail";
import PlayerAdmin from "./pages/League/PlayerAdmin";
import TradeManager from "./pages/League/TradeManager";
import AuctionHouse from "./pages/League/AuctionHouse";
import AuctionAdmin from "./pages/League/AuctionAdmin";
import TradeAdmin from "./pages/League/TradeAdmin";

export default function App() {
  return (
    <>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:abbreviation" element={<TeamDetail />} />

            {/* Protected Dashboard Layout — requires login */}
            <Route element={<ProtectedRoute />}>
              <Route index path="/" element={<Home />} />

              {/* Others Page */}
              <Route path="/profile" element={<UserProfiles />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/blank" element={<Blank />} />
              <Route path="/standings" element={<Standings />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/batter-stats" element={<BatterStats />} />
              <Route path="/pitcher-stats" element={<PitcherStats />} />
              <Route path="/player-profile" element={<PlayerProfile />} />
              <Route path="/trade-manager" element={<TradeManager />} />
              <Route path="/admin/trade-manager" element={<TradeManager />} />
              <Route path="/auction-house" element={<AuctionHouse />} />
              <Route path="/admin/auction-house" element={<AuctionHouse />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin/teams" element={<TeamAdmin />} />
                <Route path="/admin/players" element={<PlayerAdmin />} />
                <Route path="/admin/trades" element={<TradeAdmin />} />
                <Route path="/admin/auction-admin" element={<AuctionAdmin />} />
              </Route>

              {/* Forms */}
              <Route path="/form-elements" element={<FormElements />} />

              {/* Tables */}
              <Route path="/basic-tables" element={<BasicTables />} />

              {/* Ui Elements */}
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/avatars" element={<Avatars />} />
              <Route path="/badge" element={<Badges />} />
              <Route path="/buttons" element={<Buttons />} />
              <Route path="/images" element={<Images />} />
              <Route path="/videos" element={<Videos />} />

              {/* Charts */}
              <Route path="/line-chart" element={<LineChart />} />
              <Route path="/bar-chart" element={<BarChart />} />
            </Route>
          </Route>

          {/* Auth Layout */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </>
  );
}
