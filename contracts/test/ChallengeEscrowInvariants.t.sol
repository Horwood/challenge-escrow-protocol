// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {
    ChallengeEscrowInvariantHandler,
    IncomingInvariantHandler
} from "./invariant/ChallengeEscrowInvariantHandler.sol";

contract ChallengeEscrowStatefulInvariantsTest {
    ChallengeEscrowInvariantHandler private handler;

    function setUp() public {
        handler = new ChallengeEscrowInvariantHandler();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_authorizedAcceptance() public view {
        handler.assertLifecycleModel();
    }

    function invariant_monotonicLifecycle() public view {
        handler.assertLifecycleModel();
    }

    function invariant_deadlinePartition() public view {
        handler.assertLifecycleModel();
    }

    function invariant_pauseSafeExit() public view {
        handler.assertAuthorityAndPauseModel();
        handler.assertLifecycleModel();
    }

    function invariant_atomicFinance() public view {
        handler.assertFinancialModel();
    }

    function invariant_conservationAndSolvency() public view {
        handler.assertFinancialModel();
    }

    function invariant_fixedEntitlementAndSingleExit() public view {
        handler.assertFinancialModel();
    }

    function invariant_resolutionDeterminism() public view {
        handler.assertLifecycleModel();
    }

    function invariant_immutableFinality() public view {
        handler.assertLifecycleModel();
    }

    function invariant_offchainNonauthority() public view {
        handler.assertAuthorityAndPauseModel();
        handler.assertFinancialModel();
    }

    function invariant_residualHonesty() public view {
        handler.assertAuthorityAndPauseModel();
    }
}

contract IncomingTokenInvariantsTest {
    IncomingInvariantHandler private handler;

    function setUp() public {
        handler = new IncomingInvariantHandler();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_incomingTokenAtomicity() public view {
        handler.assertIncomingModel();
    }

    function invariant_incomingSolvencyAndLiability() public view {
        handler.assertIncomingModel();
    }
}
