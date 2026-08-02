// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrow } from "../src/ChallengeEscrow.sol";
import { ChallengeEscrowKernel } from "../src/ChallengeEscrowKernel.sol";
import { ChallengeTypes } from "../src/ChallengeTypes.sol";
import { AcceptancePermitHash } from "../src/libraries/AcceptancePermitHash.sol";
import { ChallengeCommitment } from "../src/libraries/ChallengeCommitment.sol";
import { AdversarialToken } from "./mocks/AdversarialToken.sol";

interface VmChallenge {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectPartialRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract CommitmentHarness {
    function executionPreimage(ChallengeTypes.ChallengeExecution memory execution)
        external
        pure
        returns (bytes memory)
    {
        return ChallengeCommitment.executionPreimage(execution);
    }

    function executionHash(ChallengeTypes.ChallengeExecution memory execution)
        external
        pure
        returns (bytes32)
    {
        return ChallengeCommitment.executionHash(execution);
    }

    function specHash(bytes32 executionHash_, bytes32 termsHash_) external pure returns (bytes32) {
        return ChallengeCommitment.specHash(executionHash_, termsHash_);
    }

    function permitDigest(
        uint256 chainId,
        address verifyingContract,
        ChallengeTypes.AcceptancePermit memory permit
    ) external pure returns (bytes32) {
        return AcceptancePermitHash.digest(
            AcceptancePermitHash.domainSeparator(
                "Challenge Escrow", "challenge-escrow-protocol/v1", chainId, verifyingContract
            ),
            permit
        );
    }
}

contract ChallengeEscrowTest {
    VmChallenge private constant vm =
        VmChallenge(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant CHALLENGER_KEY = 0xA11CE;
    uint256 private constant ACCEPTOR_KEY = 0xB0B;
    uint64 private constant NOW = 1_800_000_000;
    uint256 private constant STAKE = 10_000_000;
    bytes32 private constant EVENT_TERMS_HASH =
        0x6ade1e23704b07995277edf96ccf2285990aaee78d20a0f77219965ef9dd7665;
    bytes32 private constant EVENT_MATCH_EVIDENCE_HASH =
        0xecec38a02235c7fb45d2f1efc1d4eba53e02a066d9c1afc3de95decd1d74be6f;
    bytes32 private constant EVENT_ABSENCE_EVIDENCE_HASH =
        0x23617293ae2dd672f0120e63b585dda0ba0f3dd8d55464f8eb59a8fb05d55613;
    bytes32 private constant INCOMPLETE_EVIDENCE_HASH = keccak256("incomplete-event-range");
    bytes32 private constant AMBIGUOUS_EVIDENCE_HASH = keccak256("ambiguous-canonicality");
    bytes32 private constant RELEASE_DECLARED_SIGNATURE = keccak256(
        "ReleaseDeclared(bytes32,string,string,string,string,uint256,address,address,uint8,uint8,address,address,bool)"
    );

    address private constant RESOLVER = address(0xBEEF);
    address private constant ARBITER = address(0xCA11);
    address private constant PAUSER = address(0xF00D);

    AdversarialToken private token;
    ChallengeEscrow private release;
    address private challenger;
    address private acceptor;

    function setUp() public {
        vm.warp(NOW);
        challenger = vm.addr(CHALLENGER_KEY);
        acceptor = vm.addr(ACCEPTOR_KEY);
        token = new AdversarialToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        token.mint(challenger, STAKE * 10);
        token.mint(acceptor, STAKE * 10);
        vm.prank(challenger);
        token.approve(address(release), type(uint256).max);
        vm.prank(acceptor);
        token.approve(address(release), type(uint256).max);
    }

    function testProtocolTupleAndCommitmentDomains() public view {
        require(
            keccak256(bytes(release.EVENT_PROTOCOL_ID())) == keccak256("challenge-escrow-event/v1")
        );
        require(
            keccak256(bytes(release.PROTOCOL_VERSION()))
                == keccak256("challenge-escrow-protocol/v1")
        );
        require(
            keccak256(bytes(release.CHALLENGE_SCHEMA_ID())) == keccak256("challenge-escrow.spec/v1")
        );
        require(
            keccak256(bytes(release.EVIDENCE_SCHEMA_ID()))
                == keccak256("challenge-escrow.evidence/v1")
        );
        require(
            keccak256(bytes(release.CONDITION_LANGUAGE_ID()))
                == keccak256("challenge-escrow.condition-language/v1")
        );
        require(keccak256(bytes(release.TERMS_DOMAIN())) == keccak256("challenge-escrow.terms/v1"));
        require(keccak256(bytes(release.SPEC_DOMAIN())) == keccak256("challenge-escrow.spec/v1"));
        require(
            keccak256(bytes(release.EVIDENCE_DOMAIN())) == keccak256("challenge-escrow.evidence/v1")
        );
    }

    function testReleaseDeclaresProtocolTupleOnce() public {
        vm.recordLogs();
        ChallengeEscrow declared =
            new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        VmChallenge.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1 && logs[0].emitter == address(declared));
        require(logs[0].topics.length == 2 && logs[0].topics[0] == RELEASE_DECLARED_SIGNATURE);
        require(logs[0].topics[1] == declared.releaseId());
        require(keccak256(logs[0].data) == keccak256(_expectedReleaseData(address(declared))));
    }

    function testGoldenCommitments() public {
        CommitmentHarness harness = new CommitmentHarness();
        ChallengeTypes.ChallengeExecution memory execution = ChallengeTypes.ChallengeExecution({
            nonce: 0x4444444444444444444444444444444444444444444444444444444444444444,
            createdAt: 1_783_814_400,
            chainId: 31_337,
            escrowContract: 0x1111111111111111111111111111111111111111,
            challengerWallet: 0x2222222222222222222222222222222222222222,
            challengerSide: ChallengeTypes.Side.A,
            token: 0x3333333333333333333333333333333333333333,
            tokenDecimals: 6,
            stakeAmount: 10_000_000,
            acceptanceDeadline: 1_783_818_000,
            observationTime: 1_783_900_800,
            sourceCorrectionCutoff: 1_783_908_000,
            proposalDeadline: 1_783_911_600,
            disputeWindowSeconds: 43_200,
            arbitrationWindowSeconds: 43_200,
            timeoutVoidAt: 1_783_998_000
        });
        bytes memory preimage = harness.executionPreimage(execution);
        bytes32 executionHash = harness.executionHash(execution);
        require(preimage.length == 576);
        require(executionHash == 0x6d37395adf5235337c3406185ee76d2625cb08f06e66df2f49d6e28a467840db);
        bytes32 termsHash = 0x71fa6106febe78f33bf5516b0937e5b0fc88b1e9fec99d651838c2566fdd7f96;
        require(
            harness.specHash(executionHash, termsHash)
                == 0x79378c69fed2b3643b9538784042f8fe8294615bf10067dc6af244341f17fa1b
        );

        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: 0x4fec9d991acf60bc3d2323b19172b6e153976f439cc55eb5796b3a494350f77d,
            specHash: 0x79378c69fed2b3643b9538784042f8fe8294615bf10067dc6af244341f17fa1b,
            acceptingWallet: 0x7777777777777777777777777777777777777777,
            acceptanceNonce: 0,
            expiresAt: 1_783_814_400
        });
        require(
            harness.permitDigest(31_337, 0x1111111111111111111111111111111111111111, permit)
                == 0xab9ac8d4225e1ea168425dfa0adf5cde3aac56825395d7146df47fb0ba65effc
        );
    }

    function testCanonicalTokenMustBeAContract() public {
        vm.expectPartialRevert(ChallengeEscrowKernel.CanonicalTokenHasNoCode.selector);
        new ChallengeEscrow(address(0x1234), 6, RESOLVER, ARBITER, PAUSER, false);
    }

    function testPauserCannotBeChallenger() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(101)), ChallengeTypes.Side.A);
        execution.challengerWallet = PAUSER;
        token.mint(PAUSER, STAKE);
        vm.prank(PAUSER);
        token.approve(address(release), STAKE);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);

        vm.expectPartialRevert(ChallengeEscrow.ParticipantIsPauser.selector);
        vm.prank(PAUSER);
        release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
    }

    function testPauserCannotAccept() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(102)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        bytes32 challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: PAUSER,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        token.mint(PAUSER, STAKE);
        vm.prank(PAUSER);
        token.approve(address(release), STAKE);

        vm.expectPartialRevert(ChallengeEscrow.ParticipantIsPauser.selector);
        vm.prank(PAUSER);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function testEventMatchSideAReachesIndependentPullPayout() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(1)), ChallengeTypes.Side.A);
        uint256 challengerBefore = token.rawBalanceOf(challenger);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.A,
            uint8(ChallengeTypes.ABReason.PRIMARY_OBSERVATION),
            EVENT_MATCH_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        require(token.rawBalanceOf(challenger) == challengerBefore + STAKE * 2);
        require(release.totalOutstandingLiability() == 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.RESOLVED_A);
    }

    function testCompleteEventAbsenceSideBReachesPullPayout() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(2)), ChallengeTypes.Side.A);
        uint256 acceptorBefore = token.rawBalanceOf(acceptor);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.B,
            uint8(ChallengeTypes.ABReason.PRIMARY_OBSERVATION),
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        vm.prank(acceptor);
        release.claimWinnings(challengeId);
        require(token.rawBalanceOf(acceptor) == acceptorBefore + STAKE * 2);
        require(release.totalOutstandingLiability() == 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.RESOLVED_B);
    }

    function testIncompleteEventEvidenceFailsClosedToVoidAndIndependentRefunds() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(3)), ChallengeTypes.Side.A);
        vm.warp(execution.sourceCorrectionCutoff);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA),
            INCOMPLETE_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        _refundBoth(challengeId);
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(challenge.state == ChallengeTypes.LifecycleState.VOID);
        require(
            challenge.finalResolution.evidenceVoidReason
                == ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA
        );
        require(release.totalOutstandingLiability() == 0);
    }

    function testUnresolvedCanonicalityFailsClosedToVoidAndIndependentRefunds() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(4)), ChallengeTypes.Side.B);
        vm.warp(execution.sourceCorrectionCutoff);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.AMBIGUOUS_SOURCE_RECORD),
            AMBIGUOUS_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        _refundBoth(challengeId);
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(challenge.state == ChallengeTypes.LifecycleState.VOID);
        require(
            challenge.finalResolution.evidenceVoidReason
                == ChallengeTypes.EvidenceVoidReason.AMBIGUOUS_SOURCE_RECORD
        );
        require(release.totalOutstandingLiability() == 0);
    }

    function testContractOwnedEvidenceBoundariesRejectZeroHashBadReasonAndWrongParent() public {
        (bytes32 zeroId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(5)), ChallengeTypes.Side.A);
        vm.warp(execution.observationTime);
        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroEvidenceHash.selector);
        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 0, bytes32(0));
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidOutcomeReason.selector);
        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 4, EVENT_MATCH_EVIDENCE_HASH);

        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.expectPartialRevert(ChallengeEscrowKernel.ParentEvidenceHashMismatch.selector);
        vm.prank(challenger);
        release.dispute(
            zeroId, ChallengeTypes.Outcome.B, 0, EVENT_ABSENCE_EVIDENCE_HASH, bytes32(uint256(1))
        );
        require(release.getChallenge(zeroId).state == ChallengeTypes.LifecycleState.PROPOSED);
    }

    function _active(bytes32 nonce, ChallengeTypes.Side side)
        private
        returns (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution)
    {
        execution = _execution(nonce, side);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function _execution(bytes32 nonce, ChallengeTypes.Side side)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory)
    {
        uint64 currentTime = uint64(block.timestamp);
        return ChallengeTypes.ChallengeExecution({
            nonce: nonce,
            createdAt: currentTime - 1,
            chainId: block.chainid,
            escrowContract: address(release),
            challengerWallet: challenger,
            challengerSide: side,
            token: address(token),
            tokenDecimals: 6,
            stakeAmount: STAKE,
            acceptanceDeadline: currentTime + 100,
            observationTime: currentTime + 200,
            sourceCorrectionCutoff: currentTime + 300,
            proposalDeadline: currentTime + 400,
            disputeWindowSeconds: 200,
            arbitrationWindowSeconds: 200,
            timeoutVoidAt: currentTime + 1_000
        });
    }

    function _refundBoth(bytes32 challengeId) private {
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        vm.prank(acceptor);
        release.refundPrincipal(challengeId);
    }

    function _expectedReleaseData(address declared) private view returns (bytes memory) {
        return abi.encode(
            "challenge-escrow-event/v1",
            "challenge-escrow-protocol/v1",
            "challenge-escrow.spec/v1",
            "challenge-escrow.evidence/v1",
            block.chainid,
            declared,
            address(token),
            uint8(6),
            ChallengeTypes.ValueMode.TESTNET_NO_VALUE,
            RESOLVER,
            ARBITER,
            false
        );
    }
}
